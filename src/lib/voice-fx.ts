/**
 * The room the spoken lines are heard in. Each recording is played through a
 * small studio chain made in the browser (Web Audio), so the files stay plain
 * and the sound can be tuned here:
 *
 *   voice → clean-up EQ ─┬─ dry ─────────────────────────────┐
 *                        ├─ pre-delay → stone-hall reverb ───┼→ compressor → speakers
 *                        └─ dark echo (fading repeats) ──────┘
 *
 * The EQ trims rumble, gives the voice weight and a little presence; the
 * reverb is generated (dark noise dying away, with a few early reflections
 * off near walls), and the compressor holds every line at the same level.
 *
 * Client only; without Web Audio a line simply plays dry.
 */

export type Room = "vast" | "hall" | "close";

type Preset = {
  /** reverb length (s) and how fast it dies (higher = sooner) */
  tail: number;
  decay: number;
  /** gap before the hall answers (s): keeps the words clear */
  pre: number;
  /** how dark the reverb is: frequencies above this fall away */
  cut: number;
  wet: number;
  /** echo: delay (s), how much of each repeat comes back, and its level (0 = none) */
  echo: number;
  feedback: number;
  echoWet: number;
  /** low-end weight added to the voice (dB) */
  weight: number;
};

const PRESETS: Record<Room, Preset> = {
  // the bosses, and the fall of one: a cathedral of stone
  vast: { tail: 4.2, decay: 3.2, pre: 0.03, cut: 2800, wet: 0.38, echo: 0.36, feedback: 0.16, echoWet: 0.06, weight: 4 },
  // the narrator: a great hall, but every word still clear
  hall: { tail: 3.0, decay: 3.6, pre: 0.022, cut: 3400, wet: 0.28, echo: 0.29, feedback: 0.2, echoWet: 0.08, weight: 2.5 },
  // a word in your ear: a small dark room, no echo
  close: { tail: 1.4, decay: 4, pre: 0.008, cut: 2400, wet: 0.2, echo: 0, feedback: 0, echoWet: 0, weight: 1 },
};

/** Make-up gain after the compressor. */
const LEVEL = 1.15;

let ctx: AudioContext | null = null;
/** Where every room meets: the compressor. */
let bus: AudioNode | null = null;
let out: GainNode | null = null;
const rooms = new Map<Room, AudioNode>();

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();

  // glue: a gentle compressor, then a little make-up gain
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.006;
  comp.release.value = 0.25;
  out = ctx.createGain();
  out.gain.value = LEVEL;
  comp.connect(out).connect(ctx.destination);
  bus = comp;
  return ctx;
}

/** A stone room's answer: dark noise dying away, after a few early reflections. */
function impulse(ac: AudioContext, p: Preset): AudioBuffer {
  const rate = ac.sampleRate;
  const len = Math.floor(rate * p.tail);
  const buf = ac.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // the tail darkens as it fades: stone swallows the highs first
      const k = 0.55 - 0.45 * t;
      lp += ((Math.random() * 2 - 1) - lp) * k;
      d[i] = lp * Math.pow(1 - t, p.decay);
    }
    // near walls: a handful of distinct early reflections, different per ear
    for (let r = 0; r < 6; r++) {
      const at = Math.floor(rate * (0.011 + Math.random() * 0.05));
      d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.5 - r * 0.06);
    }
  }
  return buf;
}

/** The chain for one room, built once and shared by every line heard in it. */
function room(ac: AudioContext, name: Room): AudioNode {
  const have = rooms.get(name);
  if (have) return have;
  const p = PRESETS[name];

  const input = ac.createGain();
  const low = ac.createBiquadFilter();
  low.type = "highpass";
  low.frequency.value = 70;
  const body = ac.createBiquadFilter();
  body.type = "lowshelf";
  body.frequency.value = 160;
  body.gain.value = p.weight;
  const presence = ac.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 3000;
  presence.Q.value = 0.9;
  presence.gain.value = 2;
  input.connect(low).connect(body).connect(presence);

  // dry
  presence.connect(bus!);

  // the hall
  const pre = ac.createDelay(0.2);
  pre.delayTime.value = p.pre;
  const verb = ac.createConvolver();
  verb.buffer = impulse(ac, p);
  const dark = ac.createBiquadFilter();
  dark.type = "lowpass";
  dark.frequency.value = p.cut;
  const wet = ac.createGain();
  wet.gain.value = p.wet;
  presence.connect(pre).connect(verb).connect(dark).connect(wet).connect(bus!);

  // the echo: each repeat a little darker and fainter, and into the hall too
  if (p.echoWet > 0) {
    const delay = ac.createDelay(1);
    delay.delayTime.value = p.echo;
    const back = ac.createGain();
    back.gain.value = p.feedback;
    const dim = ac.createBiquadFilter();
    dim.type = "lowpass";
    dim.frequency.value = 2200;
    delay.connect(dim).connect(back).connect(delay);
    const level = ac.createGain();
    level.gain.value = p.echoWet;
    presence.connect(delay);
    dim.connect(level);
    level.connect(bus!);
    level.connect(pre);
  }

  rooms.set(name, input);
  return input;
}

/**
 * Send a recording through a room. Returns the context it plays in (which
 * must be running for anything to be heard) and a release for when it ends,
 * or null if this browser has no Web Audio (the line then plays dry).
 */
export function throughRoom(
  audio: HTMLAudioElement,
  name: Room,
): { ctx: AudioContext; release: () => void } | null {
  const ac = context();
  if (!ac) return null;
  try {
    const src = ac.createMediaElementSource(audio);
    src.connect(room(ac, name));
    if (out) {
      out.gain.cancelScheduledValues(ac.currentTime);
      out.gain.setValueAtTime(LEVEL, ac.currentTime);
    }
    // the source lets go; the hall keeps ringing out on its own
    return { ctx: ac, release: () => src.disconnect() };
  } catch {
    return null;
  }
}

/** Sound switched off: let even the ringing hall fall silent at once. */
export function silenceRooms(): void {
  if (!ctx || !out) return;
  out.gain.cancelScheduledValues(ctx.currentTime);
  out.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
}
