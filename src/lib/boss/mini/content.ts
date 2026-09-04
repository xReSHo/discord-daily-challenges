/**
 * The Unraveled Saint — mini-arena content.
 *
 * Deliberately NOT the daily trials: its own short verse pool, its own seeded
 * derivation (fresh every run, never frozen per-day), and shrunk parameters.
 * The seed carries a per-run nonce so the client can't pre-compute or replay a
 * favourable draw.
 *
 * No server deps — the derive fns run on the server (authoritative re-derive on
 * submit) only; the client receives the derived content.
 */

import { hashSeed, mulberry32 } from "@/lib/boss/mechanics/prng";

/** Short scripture-ribbon lines. Lowercase, only ` . , '` — same clean set as
 *  the daily typing pool, but a different pool entirely. */
const VERSES = [
  "the tower remembers every name it was given and forgets the one it chose for itself",
  "count the doors you did not open, they are the rooms you still live in",
  "a vow is a thread, pull it and the whole garment comes apart in your hands",
  "the saint unwinds slowly, each turn of the wrapping a year he cannot take back",
  "what is written on the inside of the bandage is never read by the one it binds",
  "grief is patient, it will wait at the bottom of the water for as long as it takes",
  "the eclipse does not end the day, it only asks you to choose which light to trust",
  "every relic is a question the faithful agreed to stop asking out loud",
  "the silt rises one grain at a time until the cathedral is a hill of quiet mud",
  "he blessed the crowd with a hand that was already coming loose at the wrist",
  "the ledger is honest, it is the columns that lie about which side you are on",
  "you may keep the crown, it was always heavier than the head it was measured for",
  "the drowned still bow when the tide comes in, old habits outlast the lungs",
  "a promise spoken twice is a promise no longer trusted by either mouth",
  "the unraveled saint teaches that holiness and coming apart are the same motion",
  "read the ribbon while it passes, you will not get a second turn at that line",
  "the dusk keeps its own hours and does not consult the clock on the wall",
  "faith is the rope, doubt is the knot, and the drop below is exactly as far as it looks",
  "he counted his miracles on the fingers that remained and came up short by three",
  "the vault opens for anyone willing to admit they do not know what is inside",
  "salt in the wound is the wound telling you it is still paying attention",
  "the second dusk is not darker than the first, only harder to mistake for morning",
  "what the tide takes it files away neatly and never once returns a single page",
  "the cardinal's sermon was mostly silt by the end, and the pews did not notice",
];

export type MiniTypingContent = { text: string };

export function miniTyping(seed: string, words: number): MiniTypingContent {
  const rng = mulberry32(hashSeed(seed));
  const verse = VERSES[Math.floor(rng() * VERSES.length)];
  const all = verse.split(" ");
  const n = Math.max(4, Math.min(words, all.length));
  if (all.length <= n) return { text: verse };
  const start = Math.floor(rng() * (all.length - n + 1));
  return { text: all.slice(start, start + n).join(" ") };
}

export type MiniAimContent = {
  targets: { x: number; y: number }[];
  radius: number;
  count: number;
};

export function miniAim(
  seed: string,
  count: number,
  radius: number,
): MiniAimContent {
  const rng = mulberry32(hashSeed(seed));
  const targets: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    targets.push({
      x: Number((0.1 + rng() * 0.8).toFixed(4)),
      y: Number((0.12 + rng() * 0.76).toFixed(4)),
    });
  }
  return { targets, radius, count };
}

export type MiniLitanyContent = { sequence: number[]; glyphs: number };

export function miniLitany(
  seed: string,
  len: number,
  glyphs: number,
): MiniLitanyContent {
  const rng = mulberry32(hashSeed(seed));
  const sequence: number[] = [];
  let last = -1;
  for (let i = 0; i < len; i++) {
    let g = Math.floor(rng() * glyphs);
    if (g === last) g = (g + 1) % glyphs;
    sequence.push(g);
    last = g;
  }
  return { sequence, glyphs };
}
