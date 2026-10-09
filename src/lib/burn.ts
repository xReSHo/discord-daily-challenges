import { ART, artSrc } from "@/lib/art";
import type { FlowStop } from "@/lib/page-flow";

/**
 * The burn-through between pages (driven by components/PageFlow).
 *
 * A title card for the neighbouring page — its artwork across the whole window
 * with its name in the middle — is painted once into a picture the size of the
 * window and kept "behind" the page being left. As the visitor pushes on
 * past the edge, holes burn through at scattered places — ragged, with a
 * glowing rim and a scorched fringe — and show that picture; they grow and
 * join until the whole page has burned away. Let go and they close again.
 *
 * How it stays cheap:
 *  - One WebGL canvas, one draw call a frame. Where a hole is, and how hot its
 *    edge, comes from comparing a small tiling noise texture against a single
 *    number (how far the burn has gone), so the cost does not grow with the
 *    number of holes and nothing is computed on the main thread per pixel.
 *  - Nothing exists until the first push: no context, no textures, no frames.
 *    The loop stops, and the canvas is hidden, the moment the page is whole.
 *  - The picture of the next page is painted once per burn, not per frame.
 *
 * Where WebGL is not available `createBurn` returns null and PageFlow falls
 * back to the plain slide.
 */

export type Burn = {
  /** Burn towards `stop` to this extent (0 = whole page, 1 = burned through). */
  aim: (stop: FlowStop, extent: number) => void;
  /** Burn the rest of the way; resolves when nothing of the page is left. */
  finish: (stop: FlowStop, ms?: number) => Promise<void>;
  dispose: () => void;
};

/** The longest it takes for the holes to close once left alone (seconds). */
const HEAL_S = 0.9;

const VERT = `
attribute vec2 p;
varying vec2 uv;
void main() {
  uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// `d` is how far a point is from burning: below zero it has burned through.
// Just above zero is the glowing rim; a little further, the scorched fringe.
const FRAG = `
precision mediump float;
varying vec2 uv;
uniform sampler2D page;
uniform sampler2D noise;
uniform vec2 size;
uniform vec2 seed;
uniform float level;
uniform float time;

void main() {
  vec2 q = uv * size / 1500.0 + seed;
  // two layers of the same noise, turned against each other so the tiling
  // never shows, plus a fine one that makes the edges ragged
  vec2 r = vec2(q.x * 0.8 - q.y * 0.6, q.x * 0.6 + q.y * 0.8) * 0.71 + 0.37;
  float h = texture2D(noise, q).r * 0.5 + texture2D(noise, r).r * 0.38 + texture2D(noise, q * 5.3).r * 0.12;
  float d = h - level;
  if (d > 0.12) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float flicker = 0.78 + 0.44 * texture2D(noise, q * 4.0 + vec2(time * 0.21, -time * 0.16)).r;
  float through = 1.0 - smoothstep(-0.003, 0.003, d);
  float rim = (1.0 - smoothstep(0.0, 0.03, d)) * flicker;
  float scorch = (1.0 - smoothstep(0.015, 0.12, d)) * 0.88;
  // the heat also licks a little way into the hole
  float inner = (1.0 - smoothstep(0.0, 0.022, -d)) * 0.55 * flicker;

  vec3 ember = mix(vec3(0.72, 0.13, 0.02), vec3(1.0, 0.84, 0.46), rim * rim);
  vec3 c = vec3(0.016, 0.01, 0.006);
  float a = scorch;
  c = mix(c, ember, clamp(rim, 0.0, 1.0));
  a = max(a, clamp(rim, 0.0, 1.0));
  vec3 behind = texture2D(page, uv).rgb + vec3(1.0, 0.62, 0.22) * inner;
  c = mix(c, behind, through);
  a = max(a, through);
  gl_FragColor = vec4(c * a, a);
}`;

/** A 256² tiling noise field, made once: smooth blobs with finer detail. */
let noiseData: Uint8Array | null = null;
function noiseField(): Uint8Array {
  if (noiseData) return noiseData;
  const N = 256;
  const out = new Float32Array(N * N);
  let amp = 1;
  for (const cells of [4, 8, 16, 32]) {
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = Math.random();
    const at = (x: number, y: number) => grid[(y % cells) * cells + (x % cells)];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const gx = (x / N) * cells;
        const gy = (y / N) * cells;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        let fx = gx - x0;
        let fy = gy - y0;
        fx = fx * fx * (3 - 2 * fx);
        fy = fy * fy * (3 - 2 * fy);
        const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
        const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
        out[y * N + x] += (top * (1 - fy) + bot * fy) * amp;
      }
    }
    amp *= 0.5;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of out) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  noiseData = new Uint8Array(N * N);
  for (let i = 0; i < out.length; i++) noiseData[i] = Math.round(((out[i] - lo) / (hi - lo)) * 255);
  return noiseData;
}

/**
 * The noise level below which a given share of the page lies, so the burn can
 * be paced by area: a third of the way through the push, a third of the page
 * has gone. (Left to itself the noise is bunched around its middle value, and
 * the page would do nothing for half the push and then vanish all at once.)
 * Found by sampling the same blend of layers the shader uses.
 */
let levels: Float32Array | null = null;
function levelFor(extent: number): number {
  if (!levels) {
    const n = noiseField();
    const at = (x: number, y: number) => n[(((y % 256) + 256) % 256 | 0) * 256 + ((((x % 256) + 256) % 256) | 0)] / 255;
    const samples = new Float32Array(6000);
    for (let i = 0; i < samples.length; i++) {
      const qx = Math.random() * 256;
      const qy = Math.random() * 256;
      const rx = (qx * 0.8 - qy * 0.6) * 0.71 + 94.7;
      const ry = (qx * 0.6 + qy * 0.8) * 0.71 + 94.7;
      samples[i] = at(qx, qy) * 0.5 + at(rx, ry) * 0.38 + at(qx * 5.3, qy * 5.3) * 0.12;
    }
    samples.sort();
    levels = new Float32Array(65);
    for (let i = 0; i <= 64; i++) levels[i] = samples[Math.min(samples.length - 1, Math.round((i / 64) * (samples.length - 1)))];
    // the ends: nothing touched at 0 (not even scorched), nothing left at 1
    levels[0] -= 0.13;
    levels[64] += 0.02;
  }
  const f = Math.max(0, Math.min(1, extent)) * 64;
  const i = Math.min(63, Math.floor(f));
  return levels[i] + (levels[i + 1] - levels[i]) * (f - i);
}

const images = new Map<string, HTMLImageElement>();
/** The neighbour's artwork, fetched once and kept. */
function artImage(stop: FlowStop, want: number, onLoad: () => void): HTMLImageElement {
  const art = ART[stop.art];
  const width = art.widths.find((w) => w >= want) ?? art.widths[art.widths.length - 1];
  const src = artSrc(art, width);
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.src = src;
    images.set(src, img);
  }
  if (!img.complete) img.addEventListener("load", onLoad, { once: true });
  return img;
}

const px = (v: string) => parseFloat(v) || 0;

/**
 * Paints what lies behind the page: a title card for `stop`, like the opening
 * frame of a scene. Its artwork fills the whole window, darkened towards the
 * edges, with the page's name set large in the middle between two gold rules.
 * (The real page then settles in over it — see the "burn" page transition.)
 */
function paintPage(cv: HTMLCanvasElement, stop: FlowStop, dpr: number, repaint: () => void): void {
  const W = window.innerWidth;
  const H = window.innerHeight;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  const g = cv.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#060504";
  g.fillRect(0, 0, W, H);

  // the scene sits under the site header, which stays where it is
  const y0 = document.querySelector<HTMLElement>("header")?.offsetHeight ?? 0;
  const sh = H - y0;

  // --- the artwork, filling the window
  const img = artImage(stop, W * dpr, repaint);
  if (img.complete && img.naturalWidth) {
    const [fx, fy] = ART[stop.art].focus.split(" ").map((v) => px(v) / 100);
    const scale = Math.max(W / img.naturalWidth, sh / img.naturalHeight);
    const cw = W / scale;
    const ch = sh / scale;
    g.drawImage(img, (img.naturalWidth - cw) * fx, (img.naturalHeight - ch) * fy, cw, ch, 0, y0, W, sh);
  }

  // --- the light: dark at the edges and behind the words, as a lens would leave it
  const cx = W / 2;
  const cy = y0 + sh / 2;
  const far = Math.hypot(W, sh) / 2;
  const vignette = g.createRadialGradient(cx, cy, far * 0.25, cx, cy, far);
  vignette.addColorStop(0, "rgba(6,5,4,0.08)");
  vignette.addColorStop(0.6, "rgba(6,5,4,0.5)");
  vignette.addColorStop(1, "rgba(6,5,4,0.92)");
  g.fillStyle = vignette;
  g.fillRect(0, y0, W, sh);
  const band = g.createLinearGradient(0, y0, 0, H);
  band.addColorStop(0, "rgba(6,5,4,0.7)");
  band.addColorStop(0.3, "rgba(6,5,4,0.12)");
  band.addColorStop(0.5, "rgba(6,5,4,0.42)");
  band.addColorStop(0.7, "rgba(6,5,4,0.12)");
  band.addColorStop(1, "rgba(6,5,4,0.86)");
  g.fillStyle = band;
  g.fillRect(0, y0, W, sh);

  // --- the header band (the real header sits over this whenever it is on screen)
  g.fillStyle = "#0c0b09";
  g.fillRect(0, 0, W, y0);
  const line = g.createLinearGradient(0, 0, W, 0);
  line.addColorStop(0, "#2e271c");
  line.addColorStop(0.5, "#8a6c30");
  line.addColorStop(1, "#2e271c");
  g.fillStyle = line;
  g.fillRect(0, y0 - 1, W, 1);

  // --- the name of the place, in the site's own faces
  const face = (sel: string, fallback: string) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).fontFamily : fallback;
  };
  const spaced = g as CanvasRenderingContext2D & { letterSpacing?: string };
  const titleSize = Math.max(30, Math.min(84, W * 0.052));
  const smallSize = Math.max(10.5, Math.min(14, W * 0.0085));
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = "rgba(0,0,0,0.85)";
  g.shadowBlur = 24;
  g.shadowOffsetY = 2;

  // letter-spacing trails after the last letter; nudge right by half of it to stay centred
  const smallGap = smallSize * 0.42;
  spaced.letterSpacing = `${smallGap}px`;
  g.font = `600 ${smallSize}px ${face("[data-hero-copy] > .eyebrow", "sans-serif")}`;
  g.fillStyle = "#c8a24c";
  g.fillText(stop.eyebrow.toUpperCase(), cx + smallGap / 2, cy - titleSize * 0.95);

  const titleGap = titleSize * 0.05;
  spaced.letterSpacing = `${titleGap}px`;
  g.font = `500 ${titleSize}px ${face("[data-hero-title]", "Georgia, serif")}`;
  g.fillStyle = "#efe8d7";
  // a long name on a narrow screen is brought down to fit
  const room = W - 48;
  const wide = g.measureText(stop.title).width;
  if (wide > room) g.font = `500 ${(titleSize * room) / wide}px ${face("[data-hero-title]", "Georgia, serif")}`;
  g.fillText(stop.title, cx + titleGap / 2, cy);
  g.shadowColor = "transparent";
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;
  spaced.letterSpacing = "0px";

  // --- a gold rule with a diamond, under the name
  const ry = Math.round(cy + titleSize * 0.95) + 0.5;
  const rw = Math.min(W * 0.5, 520);
  const rule = g.createLinearGradient(cx - rw / 2, 0, cx + rw / 2, 0);
  rule.addColorStop(0, "rgba(138,108,48,0)");
  rule.addColorStop(0.3, "#8a6c30");
  rule.addColorStop(0.5, "#c8a24c");
  rule.addColorStop(0.7, "#8a6c30");
  rule.addColorStop(1, "rgba(138,108,48,0)");
  g.fillStyle = rule;
  g.fillRect(cx - rw / 2, ry - 0.5, rw, 1);
  g.save();
  g.translate(cx, ry);
  g.rotate(Math.PI / 4);
  g.fillStyle = "#0a0908";
  g.fillRect(-4, -4, 8, 8);
  g.strokeStyle = "#ecca77";
  g.lineWidth = 1;
  g.strokeRect(-4, -4, 8, 8);
  g.restore();
}

export function createBurn(canvas: HTMLCanvasElement): Burn | null {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) return null;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const texture = (unit: number, wrap: number) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  };
  texture(0, gl.CLAMP_TO_EDGE);
  texture(1, gl.REPEAT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 256, 256, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, noiseField());
  const u = (name: string) => gl.getUniformLocation(prog, name);
  gl.uniform1i(u("page"), 0);
  gl.uniform1i(u("noise"), 1);
  const uSize = u("size");
  const uSeed = u("seed");
  const uLevel = u("level");
  const uTime = u("time");
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);

  const sheet = document.createElement("canvas");
  let painted: FlowStop | null = null;
  let target = 0;
  let shown = 0;
  let frame = 0;
  let last = 0;
  let dead = false;
  let whenDone: (() => void) | null = null;
  let riseRate = 9; // how briskly the burn follows the push (per second)

  const upload = () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, sheet);
  };
  const paint = (stop: FlowStop) => {
    // sharp on dense screens, but never an enormous texture
    const dpr = Math.min(window.devicePixelRatio || 1, 2, 2560 / window.innerWidth);
    paintPage(sheet, stop, dpr, () => {
      // the artwork arrived after the first paint: paint again with it
      if (!dead && painted === stop) {
        paintPage(sheet, stop, dpr, () => {});
        upload();
      }
    });
    canvas.width = sheet.width;
    canvas.height = sheet.height;
    gl.viewport(0, 0, canvas.width, canvas.height);
    upload();
    gl.uniform2f(uSize, window.innerWidth, window.innerHeight);
    // somewhere new in the noise each time, so the holes never open in the same places
    gl.uniform2f(uSeed, Math.random() * 7, Math.random() * 7);
    painted = stop;
  };

  const tick = (now: number) => {
    frame = 0;
    if (dead) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (target > shown) shown += (target - shown) * Math.min(1, dt * riseRate);
    else shown = Math.max(target, shown - dt / HEAL_S);
    if (target >= 1 && shown > 0.995) shown = 1;

    gl.uniform1f(uLevel, levelFor(shown));
    gl.uniform1f(uTime, now / 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (shown >= 1 && whenDone) {
      const done = whenDone;
      whenDone = null;
      done();
      return; // hold the last frame: the page behind is now the page
    }
    if (shown <= 0.0005 && target === 0) {
      // whole again: stop, and let the next burn start somewhere new
      canvas.removeAttribute("data-on");
      painted = null;
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  const wake = () => {
    canvas.setAttribute("data-on", "");
    if (!frame) {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  };

  return {
    aim(stop, extent) {
      if (dead || whenDone) return;
      if (extent > 0 && painted !== stop) {
        shown = 0;
        paint(stop);
      }
      target = Math.max(0, Math.min(1, extent));
      if (target > 0 || shown > 0) wake();
    },
    finish(stop, ms = 260) {
      return new Promise((resolve) => {
        if (dead) return resolve();
        if (painted !== stop) {
          shown = 0;
          paint(stop);
        }
        target = 1;
        // cover what is left in about `ms`
        riseRate = Math.max(9, 4600 / ms);
        whenDone = resolve;
        wake();
      });
    },
    dispose() {
      dead = true;
      cancelAnimationFrame(frame);
      canvas.removeAttribute("data-on");
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
