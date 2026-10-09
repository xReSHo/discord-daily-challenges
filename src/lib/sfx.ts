/**
 * The site's sound effects: a handful of short, quiet sounds, made in the
 * browser (Web Audio) rather than downloaded, so they cost nothing to load.
 * They are built to belong to the place: air moving, a dull impact, a swell
 * of low strings, all heard in a great stone hall with a long echo. No beeps,
 * and no music.
 *
 * The player can switch them off from the header; the choice is remembered on
 * this device.
 *
 * Client only. Every function is safe to call anywhere: without a browser,
 * with sound off, or before the player has touched the page (browsers allow
 * no sound until then) it simply does nothing.
 */

export type Sfx =
  | "tap"
  | "pick"
  | "found"
  | "coin"
  /** a click on empty background: the spark and its smoke */
  | "spark"
  /** the page edge catching as the visitor pushes past it */
  | "kindle"
  /** the page burning through to the next one */
  | "burn"
  /** an achievement unlocked */
  | "feat"
  /** stepping into a trial */
  | "enter"
  /** a trial won, a trial lost */
  | "win"
  | "lose"
  /** a crate with nothing in it */
  | "empty";

const KEY = "sfx";
/** Everything is turned down to this: present, never loud. */
const MASTER = 0.3;

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
/** The way into the hall: what is sent here comes back as reverb and echo. */
let hall: GainNode | null = null;
let hiss: AudioBuffer | null = null;
let lastTap = 0;
let lastSpark = 0;
let lastKindle = 0;
const listeners = new Set<() => void>();

export function sfxOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSfx(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* private mode: the choice just lasts for this visit's default */
  }
  listeners.forEach((fn) => fn());
  if (on) play("pick");
}

/** For useSyncExternalStore: re-render when the switch is flipped. */
export function watchSfx(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    out = ctx.createGain();
    out.gain.value = MASTER;
    out.connect(ctx.destination);

    // two seconds of soft noise: the raw stuff of every whoosh and impact.
    // Each sample leans on the last, which takes the harsh hiss out of it.
    hiss = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const h = hiss.getChannelData(0);
    let last = 0;
    for (let i = 0; i < h.length; i++) {
      last = last * 0.6 + (Math.random() * 2 - 1) * 0.4;
      h[i] = last * 1.8;
    }

    // the hall: three seconds of noise dying away, used as the room's reverb
    const len = Math.floor(ctx.sampleRate * 3.2);
    const room = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = room.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const reverb = ctx.createConvolver();
    reverb.buffer = room;
    const dark = ctx.createBiquadFilter();
    dark.type = "lowpass";
    dark.frequency.value = 2600;

    // and its echo: the sound again a third of a second later, fainter each time
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.34;
    const again = ctx.createGain();
    again.gain.value = 0.32;
    delay.connect(again).connect(delay);

    hall = ctx.createGain();
    hall.gain.value = 0.6;
    hall.connect(reverb).connect(dark).connect(out);
    hall.connect(delay);
    delay.connect(reverb);
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

/** Send a sound to the speakers, and some of it (`wet`) into the hall. */
function route(ac: AudioContext, from: AudioNode, wet: number) {
  from.connect(out!);
  if (wet > 0) {
    const send = ac.createGain();
    send.gain.value = wet;
    from.connect(send).connect(hall!);
  }
}

/**
 * Air moving: noise through a filter that slides from one pitch to another,
 * swelling up and dying away. Short and falling it is a flick of cloth; long
 * and rising it is something rushing toward you.
 */
function whoosh(
  ac: AudioContext,
  o: { from: number; to: number; at?: number; len: number; peak?: number; gain: number; q?: number; wet: number },
) {
  const t = ac.currentTime + (o.at ?? 0);
  const src = ac.createBufferSource();
  src.buffer = hiss;
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = o.q ?? 0.9;
  f.frequency.setValueAtTime(o.from, t);
  f.frequency.exponentialRampToValueAtTime(o.to, t + o.len);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + o.len * (o.peak ?? 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.len);
  src.connect(f).connect(g);
  route(ac, g, o.wet);
  src.start(t, Math.random());
  src.stop(t + o.len + 0.05);
}

/** A dull, heavy impact: low noise that lands at once and is gone. */
function thud(ac: AudioContext, o: { at?: number; freq: number; len: number; gain: number; wet: number }) {
  const t = ac.currentTime + (o.at ?? 0);
  const src = ac.createBufferSource();
  src.buffer = hiss;
  const f = ac.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(o.freq, t);
  f.frequency.exponentialRampToValueAtTime(o.freq * 0.4, t + o.len);
  const g = ac.createGain();
  g.gain.setValueAtTime(o.gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.len);
  src.connect(f).connect(g);
  route(ac, g, o.wet);
  src.start(t, Math.random(), o.len + 0.05);
}

/**
 * Embers snapping: a scatter of tiny bright ticks, each one a few thousandths
 * of a second of noise, at uneven moments and uneven strengths.
 */
function crackle(
  ac: AudioContext,
  o: { at?: number; len: number; count: number; gain: number; wet: number },
) {
  const t0 = ac.currentTime + (o.at ?? 0);
  const bright = ac.createBiquadFilter();
  bright.type = "highpass";
  bright.frequency.value = 1800;
  const g = ac.createGain();
  g.gain.value = 1;
  bright.connect(g);
  route(ac, g, o.wet);
  for (let i = 0; i < o.count; i++) {
    const t = t0 + Math.random() * o.len;
    const len = 0.006 + Math.random() * 0.02;
    const src = ac.createBufferSource();
    src.buffer = hiss;
    const snap = ac.createGain();
    snap.gain.setValueAtTime(o.gain * (0.35 + Math.random() * 0.65), t);
    snap.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(snap).connect(bright);
    src.start(t, Math.random() * 1.9, len + 0.01);
  }
}

/**
 * A section of low strings holding one note: several slightly out-of-tune
 * voices with a slow tremble, their edge filtered off, swelling in and fading.
 */
function strings(
  ac: AudioContext,
  o: { freq: number; at?: number; attack: number; len: number; gain: number; wet: number },
) {
  const t = ac.currentTime + (o.at ?? 0);
  const soft = ac.createBiquadFilter();
  soft.type = "lowpass";
  soft.frequency.setValueAtTime(500, t);
  soft.frequency.linearRampToValueAtTime(1500, t + o.attack);
  soft.frequency.linearRampToValueAtTime(600, t + o.len);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.gain, t + o.attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.len);
  soft.connect(g);
  route(ac, g, o.wet);

  // the tremble of a bow
  const bow = ac.createOscillator();
  bow.frequency.value = 5.2;
  const depth = ac.createGain();
  depth.gain.value = o.freq * 0.004;
  bow.connect(depth);
  bow.start(t);
  bow.stop(t + o.len + 0.1);

  for (const cents of [-9, -3, 4, 11]) {
    const voice = ac.createOscillator();
    voice.type = "sawtooth";
    voice.frequency.value = o.freq;
    voice.detune.value = cents;
    depth.connect(voice.frequency);
    const level = ac.createGain();
    level.gain.value = 0.25;
    voice.connect(level).connect(soft);
    voice.start(t);
    voice.stop(t + o.len + 0.1);
  }
}

export function play(name: Sfx): void {
  if (!sfxOn()) return;
  const ac = audio();
  if (!ac) return;

  switch (name) {
    // a short breath of air and a soft landing: a button, a link
    case "tap": {
      const now = performance.now();
      if (now - lastTap < 110) return; // never a rattle
      lastTap = now;
      whoosh(ac, { from: 1100, to: 320, len: 0.16, peak: 0.2, gain: 0.5, wet: 0.5 });
      thud(ac, { at: 0.03, freq: 240, len: 0.12, gain: 0.5, wet: 0.35 });
      break;
    }
    // a lighter flick of cloth: choosing between things
    case "pick":
      whoosh(ac, { from: 2400, to: 900, len: 0.12, peak: 0.25, gain: 0.3, wet: 0.5 });
      break;
    // air rushing in, a deep impact, and low strings swelling out into the
    // hall: something found or unlocked
    case "found":
      whoosh(ac, { from: 180, to: 2600, len: 0.75, peak: 0.85, gain: 0.55, q: 0.7, wet: 0.7 });
      thud(ac, { at: 0.7, freq: 300, len: 0.5, gain: 0.9, wet: 0.8 });
      // an open fifth with the octave above: grave, not sweet
      strings(ac, { freq: 73.42, at: 0.66, attack: 0.5, len: 3.4, gain: 0.3, wet: 0.9 });
      strings(ac, { freq: 110, at: 0.7, attack: 0.7, len: 3.2, gain: 0.22, wet: 0.9 });
      strings(ac, { freq: 146.83, at: 0.8, attack: 0.9, len: 3.0, gain: 0.16, wet: 0.9 });
      break;
    // a spark struck in the dark: a snap or two and a small breath of smoke
    case "spark": {
      const now = performance.now();
      if (now - lastSpark < 140) return;
      lastSpark = now;
      crackle(ac, { len: 0.07, count: 3, gain: 0.3, wet: 0.5 });
      whoosh(ac, { from: 700, to: 240, at: 0.02, len: 0.5, peak: 0.15, gain: 0.14, q: 0.6, wet: 0.8 });
      break;
    }
    // the edge of the page catching: a few snaps and a low lick of flame
    case "kindle": {
      const now = performance.now();
      if (now - lastKindle < 700) return;
      lastKindle = now;
      crackle(ac, { len: 0.45, count: 9, gain: 0.26, wet: 0.5 });
      whoosh(ac, { from: 260, to: 520, len: 0.55, peak: 0.5, gain: 0.2, q: 0.6, wet: 0.6 });
      break;
    }
    // the page going up: fire rushing across it, crackling, then the hall
    case "burn":
      whoosh(ac, { from: 220, to: 1500, len: 0.95, peak: 0.6, gain: 0.5, q: 0.5, wet: 0.7 });
      whoosh(ac, { from: 90, to: 260, len: 1.1, peak: 0.5, gain: 0.45, q: 0.6, wet: 0.6 });
      crackle(ac, { len: 0.9, count: 30, gain: 0.34, wet: 0.5 });
      thud(ac, { at: 0.75, freq: 200, len: 0.6, gain: 0.5, wet: 0.8 });
      break;
    // a seal pressed twice into wax, and the hall answering with brighter
    // strings than a find: an achievement
    case "feat":
      thud(ac, { freq: 420, len: 0.2, gain: 0.8, wet: 0.7 });
      thud(ac, { at: 0.22, freq: 300, len: 0.45, gain: 0.9, wet: 0.8 });
      whoosh(ac, { from: 1800, to: 5200, at: 0.2, len: 0.9, peak: 0.25, gain: 0.16, q: 1.4, wet: 0.9 });
      strings(ac, { freq: 98, at: 0.2, attack: 0.4, len: 3.0, gain: 0.28, wet: 0.9 });
      strings(ac, { freq: 146.83, at: 0.26, attack: 0.55, len: 2.8, gain: 0.2, wet: 0.9 });
      strings(ac, { freq: 196, at: 0.34, attack: 0.7, len: 2.6, gain: 0.14, wet: 0.9 });
      break;
    // a great door drawn open: air pulled inward and a deep boom behind it
    case "enter":
      whoosh(ac, { from: 140, to: 900, len: 0.6, peak: 0.8, gain: 0.5, q: 0.6, wet: 0.7 });
      thud(ac, { at: 0.56, freq: 170, len: 0.9, gain: 0.9, wet: 0.9 });
      break;
    // the trial bested: a purse and the low strings rising under it
    case "win":
      whoosh(ac, { from: 300, to: 2200, len: 0.4, peak: 0.8, gain: 0.35, q: 0.7, wet: 0.7 });
      thud(ac, { at: 0.38, freq: 340, len: 0.3, gain: 0.7, wet: 0.7 });
      strings(ac, { freq: 110, at: 0.36, attack: 0.3, len: 2.2, gain: 0.24, wet: 0.9 });
      strings(ac, { freq: 164.81, at: 0.42, attack: 0.45, len: 2.0, gain: 0.16, wet: 0.9 });
      break;
    // the trial lost: the air going out of the room, and one dull knock
    case "lose":
      whoosh(ac, { from: 900, to: 140, len: 0.7, peak: 0.15, gain: 0.35, q: 0.6, wet: 0.8 });
      thud(ac, { at: 0.3, freq: 150, len: 0.6, gain: 0.6, wet: 0.8 });
      break;
    // an empty chest: a hollow knock and a little dust
    case "empty":
      thud(ac, { freq: 520, len: 0.14, gain: 0.5, wet: 0.8 });
      whoosh(ac, { from: 500, to: 180, at: 0.05, len: 0.6, peak: 0.1, gain: 0.14, q: 0.6, wet: 0.9 });
      break;
    // a purse set down: two quick brushes of air and a weighty landing
    case "coin":
      whoosh(ac, { from: 3200, to: 1400, len: 0.09, gain: 0.3, q: 2, wet: 0.5 });
      whoosh(ac, { from: 3800, to: 1700, at: 0.08, len: 0.1, gain: 0.3, q: 2, wet: 0.5 });
      thud(ac, { at: 0.12, freq: 360, len: 0.22, gain: 0.6, wet: 0.5 });
      strings(ac, { freq: 110, at: 0.12, attack: 0.25, len: 1.4, gain: 0.12, wet: 0.9 });
      break;
  }
}
