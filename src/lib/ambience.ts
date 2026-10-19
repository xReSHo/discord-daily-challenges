import { sfxOn, watchSfx } from "@/lib/sfx";
import { level, watchLevels } from "@/lib/sound-levels";

/**
 * The sound of the place itself, under everything: a vast, ancient cavern,
 * made in the browser, never downloaded, and never music. Nothing bright and
 * nothing steady (a hiss, a patter), which reads as rain; only deep air and
 * far-off things, each on its own clock so the place never loops:
 *
 *   - the cavern's breath: deep air swelling and settling, felt more than heard
 *   - a far howl: wind finding an opening somewhere in the ruins, now and then
 *   - water: a single deep drop in the dark, ringing through the cave
 *   - falling stone: a few pebbles knocking down a slope, far off
 *   - the deep: stone settling, a low groan from below, rarely
 *
 * Everything distant is heard mostly through a long, dark echo of the place.
 * It rises slowly once the visitor first touches the page (browsers allow no
 * sound before that), follows the sound switch and the Ambience level, and
 * falls silent while the tab is hidden.
 *
 * Client only; call `startAmbience` once (the root layout does).
 */

/** The whole bed at full Ambience: kept well under the voices and effects. */
const CEILING = 0.32;
/** How long it takes to rise in, or fall away (s). */
const RISE = 4;

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let cave: ConvolverNode | null = null;
/** Brown noise: deep, soft air, with none of white noise's hiss. */
let air: AudioBuffer | null = null;
let started = false;
/** False on the pages with no sound control in reach (see Ambience.tsx). */
let allowed = true;
/** Pages that silence the room themselves, whatever their address (the caught page). */
let holds = 0;
const timers = new Set<number>();

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Every few seconds, call `fn`: the layers' own slow clocks. The first call
 * waits its turn too, so the place doesn't open with every rare sound at once.
 */
function every(min: number, max: number, fn: () => void) {
  const wait = () => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (ctx?.state === "running") fn();
      wait();
    }, rand(min, max) * 1000);
    timers.add(id);
  };
  wait();
}

function target(): number {
  return allowed && holds === 0 && sfxOn() && !document.hidden ? CEILING * level("ambience") : 0;
}

/** Ease the whole bed toward where it should be now, and let the context sleep when silent. */
function settle() {
  if (!ctx || !out) return;
  const to = target();
  const now = ctx.currentTime;
  out.gain.cancelScheduledValues(now);
  out.gain.setValueAtTime(out.gain.value, now);
  if (to > 0) {
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    out.gain.setTargetAtTime(to, now, RISE / 3);
  } else {
    out.gain.setTargetAtTime(0, now, 0.3);
    // once it has faded, let the room sleep: no work while nobody listens
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (ctx && target() === 0 && ctx.state === "running") void ctx.suspend().catch(() => {});
    }, 1500);
    timers.add(id);
  }
}

function build(ac: AudioContext) {
  out = ac.createGain();
  out.gain.value = 0;
  out.connect(ac.destination);
  const rate = ac.sampleRate;

  // eight seconds of stereo brown noise (each sample leans on the last): the
  // raw stuff of moving air and shifting stone, deep by nature
  air = ac.createBuffer(2, rate * 8, rate);
  for (let c = 0; c < 2; c++) {
    const d = air.getChannelData(c);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
  }

  // the cave itself: a long, dark answer, its highs gone almost at once
  const len = Math.floor(rate * 6);
  const room = ac.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = room.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += (Math.random() * 2 - 1 - lp) * (0.32 - 0.28 * t);
      d[i] = lp * Math.pow(1 - t, 2.2);
    }
  }
  cave = ac.createConvolver();
  cave.buffer = room;
  const caveLevel = ac.createGain();
  caveLevel.gain.value = 0.8;
  cave.connect(caveLevel).connect(out);
}

/** A looping stream of the air, offset so no two layers line up. */
function stream(ac: AudioContext): AudioBufferSourceNode {
  const src = ac.createBufferSource();
  src.buffer = air;
  src.loop = true;
  src.start(0, rand(0, 7.5));
  return src;
}

/** The cavern's breath: deep air that swells and settles, slowly, left and right. */
function breath(ac: AudioContext) {
  const low = ac.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 160;
  const gain = ac.createGain();
  gain.gain.value = 0.5;
  const pan = ac.createStereoPanner();
  stream(ac).connect(low).connect(gain).connect(pan).connect(out!);
  every(5, 11, () => {
    const t = ac.currentTime;
    gain.gain.setTargetAtTime(rand(0.3, 0.75), t, rand(2.5, 4));
    low.frequency.setTargetAtTime(rand(110, 220), t, 4);
    pan.pan.setTargetAtTime(rand(-0.4, 0.4), t, 5);
  });
}

/**
 * A far howl: wind across an opening somewhere in the ruins. A narrow, hollow
 * tone that drifts in, bends a little, and is gone; then quiet for a while.
 */
function howl(ac: AudioContext) {
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 7;
  band.frequency.value = 300;
  const gain = ac.createGain();
  gain.gain.value = 0;
  const pan = ac.createStereoPanner();
  stream(ac).connect(band).connect(gain).connect(pan);
  const dry = ac.createGain();
  dry.gain.value = 0.35;
  pan.connect(dry).connect(out!);
  pan.connect(cave!);
  every(14, 32, () => {
    const t = ac.currentTime;
    const f = rand(220, 420);
    const len = rand(5, 9);
    band.frequency.cancelScheduledValues(t);
    band.frequency.setValueAtTime(f, t);
    band.frequency.linearRampToValueAtTime(f * rand(0.85, 1.2), t + len * 0.6);
    band.frequency.linearRampToValueAtTime(f * rand(0.8, 1), t + len);
    pan.pan.setValueAtTime(rand(-0.8, 0.8), t);
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(rand(1.4, 2.2), t + len * 0.45);
    gain.gain.linearRampToValueAtTime(0, t + len);
  });
}

/** Water: a single deep drop somewhere in the dark, heard mostly as its echo. */
function drips(ac: AudioContext) {
  every(9, 22, () => {
    const t = ac.currentTime + rand(0, 1);
    const tone = ac.createOscillator();
    tone.type = "sine";
    const f = rand(520, 900);
    tone.frequency.setValueAtTime(f, t);
    tone.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.08);
    const env = ac.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.05, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    const pan = ac.createStereoPanner();
    pan.pan.value = rand(-0.8, 0.8);
    const dry = ac.createGain();
    dry.gain.value = 0.2;
    tone.connect(env).connect(pan);
    pan.connect(dry).connect(out!);
    pan.connect(cave!);
    tone.start(t);
    tone.stop(t + 0.15);
  });
}

/** Falling stone: a few pebbles knocking down a slope, far off. */
function pebbles(ac: AudioContext) {
  every(28, 60, () => {
    const n = 3 + Math.floor(Math.random() * 4);
    const pan = ac.createStereoPanner();
    pan.pan.value = rand(-0.9, 0.9);
    pan.connect(cave!);
    const dry = ac.createGain();
    dry.gain.value = 0.15;
    pan.connect(dry).connect(out!);
    let t = ac.currentTime;
    for (let i = 0; i < n; i++) {
      // each knock a little later and softer than the last, as they settle
      t += rand(0.08, 0.3) * (1 + i * 0.25);
      const knock = ac.createOscillator();
      knock.type = "triangle";
      const f = rand(180, 340);
      knock.frequency.setValueAtTime(f, t);
      knock.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.04);
      const env = ac.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.09 * (1 - i / (n + 1)), t + 0.003);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      knock.connect(env).connect(pan);
      knock.start(t);
      knock.stop(t + 0.08);
    }
  });
}

/** The deep: stone settling, a slow groan from somewhere below, rarely. */
function stone(ac: AudioContext) {
  every(40, 90, () => {
    const t = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = air;
    const low = ac.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.setValueAtTime(60, t);
    low.frequency.linearRampToValueAtTime(120, t + 1.8);
    low.frequency.linearRampToValueAtTime(55, t + 4.5);
    const env = ac.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(rand(0.8, 1.3), t + 1.8);
    env.gain.linearRampToValueAtTime(0, t + 4.6);
    src.connect(low).connect(env);
    env.connect(out!);
    env.connect(cave!);
    src.start(t, rand(0, 3), 5);
  });
}

function begin() {
  if (ctx) return settle();
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  ctx = new Ctor();
  build(ctx);
  breath(ctx);
  howl(ctx);
  drips(ctx);
  pebbles(ctx);
  stone(ctx);
  settle();
}

/** Hold the room silent until the returned release is called. */
export function holdAmbience(): () => void {
  holds++;
  if (ctx) settle();
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holds--;
    if (ctx) settle();
  };
}

/** Hush the room on a page without a sound control, and bring it back after. */
export function allowAmbience(on: boolean): void {
  if (allowed === on) return;
  allowed = on;
  if (typeof window !== "undefined" && ctx) settle();
}

/**
 * Wake the room at the visitor's first touch (and again after any touch, if
 * the browser put it to sleep). Safe to call more than once.
 */
export function startAmbience(): () => void {
  if (typeof window === "undefined" || started) return () => {};
  started = true;
  const touch = () => {
    if (target() > 0) begin();
  };
  window.addEventListener("pointerdown", touch);
  window.addEventListener("keydown", touch);
  document.addEventListener("visibilitychange", settle);
  const offSfx = watchSfx(() => (ctx ? settle() : touch()));
  const offLevels = watchLevels(() => (ctx ? settle() : touch()));
  return () => {
    window.removeEventListener("pointerdown", touch);
    window.removeEventListener("keydown", touch);
    document.removeEventListener("visibilitychange", settle);
    offSfx();
    offLevels();
    timers.forEach((id) => window.clearTimeout(id));
    timers.clear();
    void ctx?.close().catch(() => {});
    ctx = out = cave = air = null;
    started = false;
  };
}
