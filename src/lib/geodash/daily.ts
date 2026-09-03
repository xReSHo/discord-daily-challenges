/**
 * Geometry Dash — seeded daily course generation.
 *
 * One course per (challenge-day, difficulty), built from **gadgets** — small
 * self-contained hazards each with a known local solution:
 *
 *   spike / double / triple  — jump over 1–3 spikes
 *   blockSpike               — a spike mounted on a low block (a taller clear)
 *   platform                 — jump up onto a block, run it, drop off
 *   orb                      — jump, tap a mid-air orb to cross a wide spike pit
 *   pad                      — a jump pad auto-launches you over a tall wall
 *   ceiling                  — a hazard on the roof: do NOT jump under it
 *   floatBar                 — a slab suspended off the floor: jump over it
 *   corridor                 — a spike then a low ceiling: jump, but not early
 *   crusher                  — a slab that drops into the lane on a timer
 *   sweeper                  — a slab that slides across the lane on a timer
 *   rotor                    — spinning blades; pass during the safe rotation
 *
 * Each gadget appends its obstacles and the jump timestamps (SIM ms) that clear
 * it, so the concatenated timestamps are a proven solution — re-checked end to
 * end with the shared `simulate` before the course is frozen (a failing gadget
 * is popped whole). Time-based gadgets pick a phase that is safe for the exact
 * sim-time the cube passes (`t = x / speed`). The first tap of every gadget is
 * snapped to an 1/8-note grid so a clean run reads as rhythmic.
 */

import { createHash } from "node:crypto";
import { simulate, hits, type Course, type Obstacle } from "./physics";

const SEED = process.env.GEODASH_SEED ?? "daily-challenges";

export type Difficulty = "easy" | "medium" | "hard" | "impossible";
export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard", "impossible"];

export function isDifficulty(v: unknown): v is Difficulty {
  return typeof v === "string" && (DIFFICULTIES as string[]).includes(v);
}

const BASE = {
  speed: 12,
  gravity: 90,
  jumpV: 27,
  orbV: 25,
  padV: 43,
  cube: 0.9,
  ceiling: 12,
} as const;

const G = BASE.gravity;
const SPD = BASE.speed;
/** ground-jump apex height (≈ 4.05) — spike tips must stay below this */
const AJ = (BASE.jumpV * BASE.jumpV) / (2 * G);

const START_PAD = 14;
const END_PAD = 12;

function arc(h: number, v0: number = BASE.jumpV) {
  const disc = Math.max(0, v0 * v0 - 2 * G * h);
  const r = Math.sqrt(disc);
  return {
    xIn: SPD * ((v0 - r) / G),
    xOut: SPD * ((v0 + r) / G),
    dist: SPD * ((2 * v0) / G),
  };
}

type GadgetKind =
  | "spike"
  | "double"
  | "triple"
  | "blockSpike"
  | "platform"
  | "orb"
  | "pad"
  | "ceiling"
  | "floatBar"
  | "corridor"
  | "crusher"
  | "sweeper"
  | "rotor";

type Tuning = {
  length: number;
  spikeH: number;
  bpm: number;
  gapMin: number;
  gapJit: number;
  /** oscillation periods (seconds) for the timed hazards — lower = faster */
  crusherPeriod: number;
  sweeperPeriod: number;
  rotorPeriod: number;
  rotorBlades: number;
  weights: Partial<Record<GadgetKind, number>>;
};

const TUNING: Record<Difficulty, Tuning> = {
  easy: {
    length: 250,
    spikeH: 2.15,
    bpm: 96,
    gapMin: 5,
    gapJit: 5,
    crusherPeriod: 1.8,
    sweeperPeriod: 2,
    rotorPeriod: 2,
    rotorBlades: 2,
    weights: { spike: 7, platform: 2, double: 1, ceiling: 1 },
  },
  medium: {
    length: 350,
    spikeH: 2.55,
    bpm: 120,
    gapMin: 3.6,
    gapJit: 3.8,
    crusherPeriod: 1.5,
    sweeperPeriod: 1.7,
    rotorPeriod: 1.8,
    rotorBlades: 2,
    weights: {
      spike: 5,
      double: 1,
      platform: 2,
      blockSpike: 2,
      pad: 1,
      ceiling: 2,
      floatBar: 1,
    },
  },
  hard: {
    length: 452,
    spikeH: 2.95,
    bpm: 140,
    gapMin: 1.9,
    gapJit: 2.6,
    crusherPeriod: 1.15,
    sweeperPeriod: 1.4,
    rotorPeriod: 1.5,
    rotorBlades: 2,
    weights: {
      spike: 3,
      double: 2,
      triple: 2,
      blockSpike: 2,
      platform: 1,
      orb: 2,
      pad: 2,
      ceiling: 1,
      floatBar: 1,
      corridor: 1,
      crusher: 1,
      sweeper: 1,
      rotor: 1,
    },
  },
  impossible: {
    length: 508,
    spikeH: 3.35,
    bpm: 160,
    gapMin: 1,
    gapJit: 1.7,
    crusherPeriod: 0.9,
    sweeperPeriod: 1.1,
    rotorPeriod: 1.15,
    rotorBlades: 3,
    weights: {
      spike: 2,
      double: 3,
      triple: 2,
      blockSpike: 2,
      orb: 3,
      pad: 2,
      ceiling: 1,
      floatBar: 1,
      corridor: 2,
      crusher: 2,
      sweeper: 2,
      rotor: 3,
    },
  },
};

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r3 = (n: number) => Number(n.toFixed(3));

type Build = {
  course: Course;
  obstacles: Obstacle[];
  solution: number[];
  rand: () => number;
  quantumSec: number;
  spikeH: number;
  tun: Tuning;
};

function tapSnapped(b: Build, x: number): number {
  const q = Math.max(0, Math.round(x / SPD / b.quantumSec) * b.quantumSec);
  b.solution.push(r3(q * 1000));
  return q * SPD;
}
function tapExact(b: Build, x: number): void {
  b.solution.push(r3((x / SPD) * 1000));
}

/** Is a single timed obstacle clear for a ground-running cube across [x0, x1]? */
function clearOnGround(b: Build, o: Obstacle, x0: number, x1: number): boolean {
  const test: Course = { ...b.course, obstacles: [o] };
  for (let x = x0; x <= x1; x += 0.12) {
    if (hits(test, x, 0, x / SPD)) return false;
  }
  return true;
}

// --- gadgets: each returns the track-x where the cube is next grounded --------

const GADGETS: Record<GadgetKind, (b: Build, cursor: number) => number> = {
  spike(b, cursor) {
    const h = b.spikeH;
    const a = arc(h);
    const xj = tapSnapped(b, cursor + 0.4 + b.rand() * 2.2);
    const mid = xj + (a.xIn + a.xOut) / 2;
    b.obstacles.push({ t: "spike", x: r3(mid - 0.45), w: 0.9, h: r3(h) });
    return xj + a.dist;
  },

  double(b, cursor) {
    const h = Math.min(b.spikeH, 2.45);
    const a = arc(h);
    const xj = tapSnapped(b, cursor + 0.4 + b.rand() * 1.8);
    const mid = xj + (a.xIn + a.xOut) / 2;
    b.obstacles.push({ t: "spike", x: r3(mid - 0.45 - 0.65), w: 0.9, h: r3(h) });
    b.obstacles.push({ t: "spike", x: r3(mid - 0.45 + 0.65), w: 0.9, h: r3(h) });
    return xj + a.dist;
  },

  triple(b, cursor) {
    const h = Math.min(b.spikeH, 2.0);
    const a = arc(h);
    const xj = tapSnapped(b, cursor + 0.4 + b.rand() * 1.6);
    const mid = xj + (a.xIn + a.xOut) / 2;
    for (const off of [-1.05, 0, 1.05]) {
      b.obstacles.push({ t: "spike", x: r3(mid - 0.45 + off), w: 0.9, h: r3(h) });
    }
    return xj + a.dist;
  },

  blockSpike(b, cursor) {
    const bh = 1.0 + b.rand() * 1.1;
    const eff = Math.min(bh + 0.95, AJ - 0.32);
    const a = arc(eff);
    const xj = tapSnapped(b, cursor + 0.5 + b.rand() * 1.5);
    const sx = xj + (a.xIn + a.xOut) / 2 - 0.45;
    b.obstacles.push({ t: "block", x: r3(sx - 0.25), w: 1.4, h: r3(bh) });
    b.obstacles.push({ t: "spike", x: r3(sx), w: 0.9, h: r3(eff) });
    return xj + a.dist;
  },

  platform(b, cursor) {
    const bh = 1.3 + b.rand() * 1.1;
    const a = arc(bh);
    const xj = tapSnapped(b, cursor + 0.4 + b.rand() * 1.1);
    const bx = xj + a.xOut - 0.35;
    const bw = 2.8 + b.rand() * 1.8;
    b.obstacles.push({ t: "block", x: r3(bx), w: r3(bw), h: r3(bh) });
    return bx + bw + 3;
  },

  orb(b, cursor) {
    const xj = tapSnapped(b, cursor + 0.4 + b.rand() * 0.9);
    const orbX = xj + 1.5 + b.rand() * 0.5;
    const orbY = 2.3;
    tapExact(b, orbX);
    b.obstacles.push({ t: "orb", x: r3(orbX), y: orbY });
    const yAtTap = Math.max(
      0,
      BASE.jumpV * ((orbX - xj) / SPD) - 0.5 * G * ((orbX - xj) / SPD) ** 2,
    );
    const tDown = (BASE.orbV + Math.sqrt(BASE.orbV ** 2 + 2 * G * yAtTap)) / G;
    const land2 = orbX + SPD * tDown;
    const pitStart = orbX + 1.2;
    const pitEnd = land2 - 2;
    for (let x = pitStart; x + 0.9 < pitEnd; x += 1.15) {
      b.obstacles.push({ t: "spike", x: r3(x), w: 0.9, h: 1.6 });
    }
    return land2 + 1.4;
  },

  pad(b, cursor) {
    const padX = cursor + 1 + b.rand() * 1.2;
    b.obstacles.push({ t: "pad", x: r3(padX), y: 0 });
    const wallH = 4.3 + b.rand() * 1.9;
    const a = arc(wallH, BASE.padV);
    const mid = padX + (a.xIn + a.xOut) / 2;
    b.obstacles.push({ t: "spike", x: r3(mid - 0.45), w: 0.9, h: r3(wallH) });
    return padX + a.dist;
  },

  // ---- new: vertical / mid-air / timed hazards ----

  /** roof hazard — the solution just doesn't jump here, then jumps a trailing spike */
  ceiling(b, cursor) {
    const cx = cursor + 1 + b.rand() * 1;
    const cw = 2.4 + b.rand() * 2.6;
    b.obstacles.push({ t: "ceil", x: r3(cx), w: r3(cw), y: 2.0 });
    // a floor spike well after the roof ends: "hold… hold… now jump"
    const h = Math.min(b.spikeH, 2.3);
    const a = arc(h);
    let xj = tapSnapped(b, cx + cw + 2.8 + b.rand() * 1.4);
    // snapping must not pull the launch back under the roof
    if (xj < cx + cw + 0.8) {
      xj = cx + cw + 0.8;
      b.solution[b.solution.length - 1] = r3((xj / SPD) * 1000);
    }
    const mid = xj + (a.xIn + a.xOut) / 2;
    b.obstacles.push({ t: "spike", x: r3(mid - 0.45), w: 0.9, h: r3(h) });
    return xj + a.dist;
  },

  /** a slab off the floor — jump over it (clear its top edge) */
  floatBar(b, cursor) {
    const gap = 0.55 + b.rand() * 0.3; // clearance under it — always lethal on the ground
    const fh = 1.3 + b.rand() * 0.7;
    const topH = gap + fh;
    const a = arc(topH);
    const xj = tapSnapped(b, cursor + 0.4 + b.rand() * 1.4);
    const fw = 1.6 + b.rand() * 1.6;
    const mid = xj + (a.xIn + a.xOut) / 2;
    b.obstacles.push({
      t: "float",
      x: r3(mid - fw / 2),
      w: r3(fw),
      y: r3(gap),
      h: r3(fh),
    });
    return xj + a.dist;
  },

  /** jump up onto a platform, then thread a low ceiling over its far half —
   *  land in the first stretch or the descending arc clips the roof */
  corridor(b, cursor) {
    const bh = 1.3 + b.rand() * 0.5; // 1.3 – 1.8
    const a = arc(bh);
    const xj = tapSnapped(b, cursor + 0.4 + b.rand() * 1);
    const bx = xj + a.xOut - 0.6;
    const bw = 5 + b.rand() * 1.6;
    b.obstacles.push({ t: "block", x: r3(bx), w: r3(bw), h: r3(bh) });
    b.obstacles.push({
      t: "ceil",
      x: r3(bx + 2),
      w: r3(bw - 2.6),
      y: r3(bh + 1.35),
    });
    return bx + bw + 3;
  },

  /** a slab that drops into the lane on a timer — pass while it's up */
  crusher(b, cursor) {
    const mx = cursor + 1.4 + b.rand() * 1.4;
    const period = b.tun.crusherPeriod;
    const amp = 1.35;
    const y0 = 0;
    const w = 1;
    const h = 1.6;
    const passT = (mx + w / 2) / SPD;
    const omega = (2 * Math.PI) / period;
    // peak (slab highest) at passT
    let phase = Math.PI / 2 - omega * passT;
    const mk = (ph: number): Obstacle => ({
      t: "mover", x: r3(mx), y: y0, w, h, ax: "y", amp, period, phase: ph,
    });
    if (!clearOnGround(b, mk(phase), mx - 2, mx + 2)) {
      for (const d of [0.3, -0.3, 0.6, -0.6, 1, -1]) {
        if (clearOnGround(b, mk(phase + d), mx - 2, mx + 2)) {
          phase += d;
          break;
        }
      }
    }
    b.obstacles.push(mk(r3(phase)));
    return mx + 2.2;
  },

  /** a slab that slides across the lane — pass while it's swung aside */
  sweeper(b, cursor) {
    const sx = cursor + 2 + b.rand() * 1.5;
    const period = b.tun.sweeperPeriod;
    const amp = 2.7;
    const w = 1;
    const h = 1.9;
    const passT = sx / SPD;
    const omega = (2 * Math.PI) / period;
    let phase = Math.PI / 2 - omega * passT; // swung to +amp (ahead) at passT
    const mk = (ph: number): Obstacle => ({
      t: "mover", x: r3(sx - w / 2), y: 0, w, h, ax: "x", amp, period, phase: ph,
    });
    if (!clearOnGround(b, mk(phase), sx - 2.5, sx + 2.5)) {
      for (const d of [Math.PI, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
        if (clearOnGround(b, mk(phase + d), sx - 2.5, sx + 2.5)) {
          phase += d;
          break;
        }
      }
    }
    b.obstacles.push(mk(r3(phase)));
    return sx + 3;
  },

  /** spinning blades — pass during the safe rotation window */
  rotor(b, cursor) {
    const rx = cursor + 2.2 + b.rand() * 1.5;
    const blades = b.tun.rotorBlades;
    const period = b.tun.rotorPeriod;
    const r = blades >= 3 ? 1.7 : 1.95;
    const ry = blades >= 3 ? 2.15 : 1.95;
    const hub = 0.34;
    const passT = rx / SPD;
    const omega = (2 * Math.PI) / period;
    const base = -omega * passT;
    const mk = (ph: number): Obstacle => ({
      t: "rotor", x: r3(rx), y: r3(ry), r, hub, blades, period, phase: ph,
    });
    let phase = base;
    let found = false;
    for (const off of [Math.PI / 2, 0, Math.PI / 4, Math.PI / 3, Math.PI, 0.9, 1.8, 2.6]) {
      if (clearOnGround(b, mk(base + off), rx - r - 1, rx + r + 1)) {
        phase = base + off;
        found = true;
        break;
      }
    }
    if (!found) {
      // widen the safe window by pushing the hub up out of reach
      b.obstacles.push({ t: "rotor", x: r3(rx), y: r3(ry + 1), r, hub, blades, period, phase: r3(base + Math.PI / 2) });
    } else {
      b.obstacles.push(mk(r3(phase)));
    }
    return rx + r + 1.5;
  },
};

export function deriveCourseWithSolution(
  dateStr: string,
  difficulty: Difficulty,
): { course: Course; solution: number[] } {
  const tun = TUNING[difficulty];
  const seed = createHash("sha256")
    .update(`${SEED}:${dateStr}:${difficulty}`)
    .digest()
    .readUInt32BE(0);
  const rand = mulberry32(seed);

  const course: Course = {
    length: tun.length,
    ...BASE,
    bpm: tun.bpm,
    obstacles: [],
  };
  const b: Build = {
    course,
    obstacles: course.obstacles,
    solution: [],
    rand,
    quantumSec: 60 / tun.bpm / 2,
    spikeH: tun.spikeH,
    tun,
  };

  const bag: GadgetKind[] = [];
  for (const [k, w] of Object.entries(tun.weights)) {
    for (let i = 0; i < (w ?? 0); i++) bag.push(k as GadgetKind);
  }

  // Build gadget by gadget, keeping each one's output as a removable chunk.
  type Chunk = { obs: Obstacle[]; sol: number[]; x0: number; x1: number };
  const chunks: Chunk[] = [];
  let cursor = START_PAD;
  let guard = 0;
  while (cursor < tun.length - END_PAD && guard++ < 600) {
    const kind =
      cursor < START_PAD + 10 ? "spike" : bag[Math.floor(rand() * bag.length)];
    const o0 = course.obstacles.length;
    const s0 = b.solution.length;
    cursor = GADGETS[kind](b, cursor) + tun.gapMin + rand() * tun.gapJit;
    const obs = course.obstacles.slice(o0);
    const xs = obs.map((o) => o.x);
    chunks.push({
      obs,
      sol: b.solution.slice(s0),
      x0: xs.length ? Math.min(...xs) : cursor,
      x1: xs.length ? Math.max(...xs) : cursor,
    });
  }

  const rebuild = () => {
    course.obstacles.length = 0;
    b.solution.length = 0;
    for (const c of chunks) {
      course.obstacles.push(...c.obs);
      b.solution.push(...c.sol);
    }
  };

  // Prove it; on a failure, drop the single gadget the death lands in.
  for (let pass = 0; pass < 40; pass++) {
    const res = simulate(course, b.solution);
    if (res.reachedEnd) break;
    const deathX = (res.distancePct / 100) * course.length;
    let idx = chunks.findIndex(
      (c) => deathX >= c.x0 - 1.5 && deathX <= c.x1 + 3.5,
    );
    if (idx < 0) {
      for (let i = chunks.length - 1; i >= 0; i--) {
        if (chunks[i].x1 <= deathX) {
          idx = i;
          break;
        }
      }
    }
    if (idx < 0) idx = 0;
    chunks.splice(idx, 1);
    rebuild();
  }

  course.obstacles.sort((p, q) => p.x - q.x);
  b.solution.sort((p, q) => p - q);
  return { course, solution: b.solution };
}
