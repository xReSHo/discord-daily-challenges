/**
 * Geometry Dash — shared deterministic physics.
 *
 * The cube runs forward at a constant speed. Inputs: a "jump" edge (fires from
 * the ground, or activates a jump orb) — jump pads fire automatically on
 * contact. The level scrolls at a fixed rate, so `s.x = speed * s.t` always and
 * the sim time to traverse the course is fixed; the server leans on that for
 * anti-cheat.
 *
 * `simulate` is PURE and is the single source of truth. Jump timestamps are in
 * SIM milliseconds (`s.t * 1000`), so the client's slow-motion orb assist —
 * which stretches real time but not sim time — needs no server model at all.
 * The client renderer runs the same fixed-step `step` from the same `Course`, so
 * what the player sees is what the server re-computes.
 *
 * Obstacle kinds:
 *   spike  — floor triangle, lethal below `h`
 *   block  — floor rectangle, land on top / clip the side = death
 *   ceil   — hangs from the top; lethal if the cube's head goes above `y`
 *   float  — a slab suspended in `[y, y+h]`; thread above or below it
 *   mover  — a slab that oscillates on one axis (deterministic in `s.t`)
 *   rotor  — spinning blades around a hub (deterministic in `s.t`)
 *   orb    — mid-air re-jump (aid, not lethal)
 *   pad    — auto-launch (aid, not lethal)
 */

export const SIM_DT = 1 / 240;

export const ORB_RADIUS = 1.45;
export const PAD_RADIUS = 0.75;

export type Obstacle =
  | { t: "spike"; x: number; w: number; h: number }
  | { t: "block"; x: number; w: number; h: number }
  | { t: "ceil"; x: number; w: number; y: number }
  | { t: "float"; x: number; w: number; y: number; h: number }
  | {
      t: "mover";
      x: number;
      y: number;
      w: number;
      h: number;
      ax: "x" | "y";
      amp: number;
      period: number;
      phase: number;
    }
  | {
      t: "rotor";
      x: number;
      y: number;
      r: number;
      hub: number;
      blades: number;
      period: number;
      phase: number;
    }
  | { t: "orb"; x: number; y: number }
  | { t: "pad"; x: number; y: number };

export type Course = {
  length: number;
  speed: number;
  gravity: number;
  jumpV: number;
  orbV: number;
  padV: number;
  cube: number;
  /** the top boundary (units) — ceiling hazards hang from here */
  ceiling: number;
  bpm: number;
  obstacles: Obstacle[];
};

export type GeoEvent = "" | "jump" | "orb" | "pad" | "land";

export type SimState = {
  t: number;
  x: number;
  y: number;
  vy: number;
  onGround: boolean;
  event: GeoEvent;
};

export function initState(): SimState {
  return { t: 0, x: 0, y: 0, vy: 0, onGround: true, event: "" };
}

function supportAt(course: Course, x: number, half: number): number {
  let s = 0;
  for (const o of course.obstacles) {
    if (o.t !== "block") continue;
    if (x + half > o.x && x - half < o.x + o.w && o.h > s) s = o.h;
  }
  return s;
}

/** Current top-left corner of a mover at sim-time `t`. */
export function moverPos(
  o: Extract<Obstacle, { t: "mover" }>,
  t: number,
): { x: number; y: number } {
  const c = o.amp * Math.sin((2 * Math.PI * t) / o.period + o.phase);
  return { x: o.ax === "x" ? o.x + c : o.x, y: o.ax === "y" ? o.y + c : o.y };
}

/** Blade angles of a rotor at sim-time `t`. */
export function rotorAngles(
  o: Extract<Obstacle, { t: "rotor" }>,
  t: number,
): number[] {
  const base = (2 * Math.PI * t) / o.period + o.phase;
  const out: number[] = [];
  for (let k = 0; k < o.blades; k++) out.push(base + (k * 2 * Math.PI) / o.blades);
  return out;
}

function angDiff(a: number, b: number): number {
  return Math.abs(((a - b + Math.PI) % (2 * Math.PI)) - Math.PI);
}

/** True when a cube centred at (x, y) at sim-time `t` is inside a lethal part of
 *  any obstacle. */
export function hits(course: Course, x: number, y: number, t: number): boolean {
  const half = course.cube / 2;
  const head = y + course.cube; // top edge of the cube

  for (const o of course.obstacles) {
    switch (o.t) {
      case "spike":
        if (x + half > o.x && x - half < o.x + o.w && y < o.h - 1e-9) return true;
        break;
      case "block":
        if (
          x + half > o.x + 0.04 &&
          x - half < o.x + o.w - 0.04 &&
          y < o.h - 0.05
        ) {
          return true;
        }
        break;
      case "ceil":
        if (x + half > o.x && x - half < o.x + o.w && head > o.y + 1e-9) return true;
        break;
      case "float":
        if (
          x + half > o.x &&
          x - half < o.x + o.w &&
          y < o.y + o.h - 1e-9 &&
          head > o.y + 1e-9
        ) {
          return true;
        }
        break;
      case "mover": {
        const p = moverPos(o, t);
        if (
          x + half > p.x &&
          x - half < p.x + o.w &&
          y < p.y + o.h - 1e-9 &&
          head > p.y + 1e-9
        ) {
          return true;
        }
        break;
      }
      case "rotor": {
        const dx = x - o.x;
        const dy = y + half - o.y;
        const d = Math.hypot(dx, dy);
        if (d < o.hub + half) return true;
        if (d < o.r + half) {
          const ang = Math.atan2(dy, dx);
          for (const ba of rotorAngles(o, t)) {
            const arc = 0.26 + half / Math.max(0.6, d);
            if (angDiff(ang, ba) < arc) return true;
          }
        }
        break;
      }
    }
  }
  return false;
}

export function step(
  s: SimState,
  course: Course,
  jump: boolean,
  consumed: Set<number>,
): void {
  const half = course.cube / 2;
  const prevY = s.y;
  const wasAir = !s.onGround;
  s.event = "";

  s.t += SIM_DT;
  s.x = course.speed * s.t;

  const support = supportAt(course, s.x, half);

  if (jump) {
    let used = false;
    for (let i = 0; i < course.obstacles.length; i++) {
      const o = course.obstacles[i];
      if (o.t !== "orb" || consumed.has(i)) continue;
      const dx = s.x - o.x;
      const dy = s.y + half - o.y;
      if (dx * dx + dy * dy <= ORB_RADIUS * ORB_RADIUS) {
        s.vy = course.orbV;
        s.onGround = false;
        consumed.add(i);
        s.event = "orb";
        used = true;
        break;
      }
    }
    if (!used && s.onGround) {
      s.vy = course.jumpV;
      s.onGround = false;
      s.event = "jump";
    }
  }

  if (s.onGround) {
    for (let i = 0; i < course.obstacles.length; i++) {
      const o = course.obstacles[i];
      if (o.t !== "pad" || consumed.has(i)) continue;
      if (
        s.x + half > o.x - PAD_RADIUS &&
        s.x - half < o.x + PAD_RADIUS &&
        Math.abs(s.y - o.y) < 0.45
      ) {
        s.vy = course.padV;
        s.onGround = false;
        consumed.add(i);
        s.event = "pad";
        break;
      }
    }
  }

  s.vy -= course.gravity * SIM_DT;
  s.y += s.vy * SIM_DT;

  if (s.y <= support && prevY >= support - 0.02 && s.vy <= 0) {
    s.y = support;
    s.vy = 0;
    s.onGround = true;
  } else if (s.y <= 0) {
    s.y = 0;
    s.vy = 0;
    s.onGround = true;
  } else {
    s.onGround = false;
  }

  if (wasAir && s.onGround && s.event === "") s.event = "land";
}

export type SimResult = {
  reachedEnd: boolean;
  distancePct: number;
  deathAt: number | null;
  totalMs: number;
};

/** The fixed SIM time (ms) a clear takes — the level scroll time. */
export function expectedRunMs(course: Course): number {
  return (course.length / course.speed) * 1000;
}

export function simulate(course: Course, jumpTimes: number[]): SimResult {
  const jumps = jumpTimes
    .filter((t) => Number.isFinite(t) && t >= 0)
    .sort((a, b) => a - b);
  let ji = 0;

  const consumed = new Set<number>();
  const s = initState();
  const maxSteps = Math.ceil(course.length / course.speed / SIM_DT) + 600;

  for (let i = 0; i < maxSteps; i++) {
    const stepEndMs = (s.t + SIM_DT) * 1000;
    let jump = false;
    while (ji < jumps.length && jumps[ji] <= stepEndMs) {
      jump = true;
      ji++;
    }
    step(s, course, jump, consumed);

    if (hits(course, s.x, s.y, s.t)) {
      const ms = s.t * 1000;
      return {
        reachedEnd: false,
        distancePct: Math.min(100, (s.x / course.length) * 100),
        deathAt: ms,
        totalMs: ms,
      };
    }
    if (s.x >= course.length) {
      return { reachedEnd: true, distancePct: 100, deathAt: null, totalMs: s.t * 1000 };
    }
  }

  const ms = s.t * 1000;
  return {
    reachedEnd: false,
    distancePct: Math.min(100, (s.x / course.length) * 100),
    deathAt: ms,
    totalMs: ms,
  };
}
