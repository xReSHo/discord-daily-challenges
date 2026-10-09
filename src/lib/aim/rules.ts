/**
 * The rules of the aim trial, shared by the page that plays it and the server
 * that judges it. Nothing here touches the database or the browser, so both
 * sides compute exactly the same thing from the same numbers.
 *
 * A round is a fixed run of marks for the day. They do not wait for each other:
 * the next mark appears `gapMs` after the one before it, or sooner if the board
 * has been cleared — so a player who falls behind has several in front of them
 * at once. Each mark stays for `ttlMs` and then is gone, which is a miss. Marks
 * come in three sizes and some drift across the board in a straight line.
 *
 * All positions are fractions of the play area (x of its width, y of its
 * height); a radius is a fraction of its width; all times are milliseconds on
 * the round's own clock, which starts at zero when the first mark appears.
 *
 * The range is not one fixed shape. It is 16:10 on a wide screen and stands
 * tall on a phone, filling the screen; the page says which shape it played on
 * (`aspect`, width over height) and everything that turns a height into a
 * distance takes that into account.
 */

/** The widest the range gets (width : height), and the shape layouts are made for. */
export const ASPECT = 16 / 10;
/** The tallest it gets. */
export const MIN_ASPECT = 0.42;

/** A shape the range may honestly have. */
export function clampAspect(aspect: number): number {
  return Math.min(ASPECT, Math.max(MIN_ASPECT, aspect));
}

/**
 * How far from a mark's centre a shot may land and still strike it, in widths.
 * A pointer is held to a little more than what is drawn; a fingertip covers the
 * mark it is aiming at, so it is given more room.
 */
export function reach(r: number, touch: boolean): number {
  return touch ? r * 1.5 + 0.03 : r * 1.4;
}
/** The most the server allows: the fingertip's room and a little over, for a
 *  moving mark drawn a frame late. */
export function reachLimit(r: number): number {
  return r * 1.5 + 0.035;
}
/** The pause between clearing the board and the next mark appearing. */
export const BREATH_MS = 110;

export type AimTarget = {
  x: number;
  y: number;
  /** radius, as a fraction of the area's width */
  r: number;
  /** drift per second: vx in widths, vy in heights. Zero for a mark that holds still. */
  vx: number;
  vy: number;
};

export type AimLayout = {
  v: 2;
  targets: AimTarget[];
  /** how long a mark stays before it is lost */
  ttlMs: number;
  /** the longest wait between one mark appearing and the next */
  gapMs: number;
  /** misses (marks lost and shots that hit nothing) that end the run */
  maxMisses: number;
};

/** One mark struck: which, where the shot landed, and when. */
export type AimHit = { i: number; x: number; y: number; t: number };

/** When mark `next` is due, given when the one before it appeared and when the
 *  board was last cleared (the latest moment any earlier mark left it). */
export function nextDue(prevDue: number, clearedAt: number, gapMs: number): number {
  return Math.min(prevDue + gapMs, Math.max(clearedAt, prevDue) + BREATH_MS);
}

/**
 * When every mark is due, given the hits made. A mark that was never struck
 * leaves the board when its time runs out.
 */
export function schedule(layout: AimLayout, hitAt: Map<number, number>): number[] {
  const due: number[] = [0];
  let cleared = 0;
  for (let k = 0; k < layout.targets.length - 1; k++) {
    cleared = Math.max(cleared, hitAt.get(k) ?? due[k] + layout.ttlMs);
    due.push(nextDue(due[k], cleared, layout.gapMs));
  }
  return due;
}

/** A mark's drift down the range per second, in heights, on a range of the
 *  given shape. Layouts are made for the widest shape; on a taller range the
 *  same drift covers a smaller share of the height, so a mark moves at the same
 *  speed across the screen whichever way it is heading. */
export function driftY(target: AimTarget, aspect: number): number {
  return (target.vy * aspect) / ASPECT;
}

/** Where a mark's centre is, `age` ms after it appeared. */
export function positionAt(target: AimTarget, age: number, aspect: number = ASPECT): { x: number; y: number } {
  const s = Math.max(0, age) / 1000;
  return { x: target.x + target.vx * s, y: target.y + driftY(target, aspect) * s };
}

/** Distance between two points, in widths (so it compares with a radius). */
export function distance(ax: number, ay: number, bx: number, by: number, aspect: number = ASPECT): number {
  return Math.hypot(ax - bx, (ay - by) / aspect);
}
