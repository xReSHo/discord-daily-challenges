/**
 * How loud each kind of sound is, set by the player from the header's sound
 * panel and remembered on this device. The on/off switch over all of them
 * stays in sfx.ts (`sfxOn`); these are the three levels beneath it.
 *
 * Safe anywhere: without a browser, or with storage blocked, the defaults hold.
 */

export type Channel = "voice" | "fx" | "ambience";

export const CHANNELS: { id: Channel; label: string }[] = [
  { id: "voice", label: "Voices" },
  { id: "fx", label: "Effects" },
  { id: "ambience", label: "Ambience" },
];

/** Percent. Voices start at half, so a first line never startles. */
const DEFAULTS: Record<Channel, number> = { voice: 50, fx: 100, ambience: 40 };

const listeners = new Set<() => void>();
const cache = new Map<Channel, number>();

/** A channel's level, 0–100. */
export function levelPct(ch: Channel): number {
  const have = cache.get(ch);
  if (have !== undefined) return have;
  let pct = DEFAULTS[ch];
  try {
    const raw = localStorage.getItem(`sound.${ch}`);
    const n = raw === null ? NaN : Number(raw);
    if (Number.isFinite(n)) pct = Math.max(0, Math.min(100, Math.round(n)));
  } catch {
    /* no storage (or no browser): the default */
  }
  if (typeof window !== "undefined") cache.set(ch, pct);
  return pct;
}

/** A channel's level as a gain, 0–1. */
export function level(ch: Channel): number {
  return levelPct(ch) / 100;
}

export function setLevel(ch: Channel, pct: number): void {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  cache.set(ch, v);
  try {
    localStorage.setItem(`sound.${ch}`, String(v));
  } catch {
    /* lasts for this visit only */
  }
  listeners.forEach((fn) => fn());
}

/** For useSyncExternalStore, and for sounds already playing to follow a slider. */
export function watchLevels(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
