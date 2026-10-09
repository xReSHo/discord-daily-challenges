/**
 * The site's artwork: one entry per picture, used by <ArtImage>.
 *
 * Every picture lives in public/art as WebP at a few widths, named
 * `<name>-v<n>-<width>.webp`, so each device downloads the smallest file that
 * is still sharp on its screen. The files are cached as immutable (see
 * next.config.ts) — bump the `-v<n>` when replacing one.
 *
 * `focus` is the part of the picture that must stay in view when it is cropped
 * to a different shape (CSS object-position).
 *
 */

export type Art = {
  /** Path without the width and extension. */
  base: string;
  /** Widths available, smallest first. Empty: a single file at `${base}.webp`. */
  widths: number[];
  focus: string;
};

const WIDE = [960, 1600, 2400];
const CARD = [640, 1280, 1920];

export const ART = {
  /** landing page and the player's record: a ruined kingdom under a far golden tree */
  hero: { base: "/art/hero-v1", widths: WIDE, focus: "68% 46%" },
  /** dashboard: the hall of lit archways */
  trials: { base: "/art/trials-v1", widths: WIDE, focus: "70% 34%" },
  wordle: { base: "/art/wordle-v1", widths: CARD, focus: "62% 46%" },
  aim: { base: "/art/aim-v1", widths: CARD, focus: "48% 50%" },
  braziers: { base: "/art/braziers-v1", widths: CARD, focus: "26% 56%" },
  boss: { base: "/art/boss-v1", widths: WIDE, focus: "50% 52%" },
  /** the duelling pit */
  pit: { base: "/art/pit-v1", widths: [960, 1600, 2048], focus: "50% 40%" },
  shop: { base: "/art/shop-v1", widths: WIDE, focus: "82% 58%" },
  achievements: { base: "/art/achievements-v1", widths: WIDE, focus: "68% 42%" },
  leaderboard: { base: "/art/leaderboard-v1", widths: WIDE, focus: "50% 62%" },
  /** a game taken offline: the chained door */
  sealed: { base: "/art/sealed-v1", widths: WIDE, focus: "50% 62%" },
} satisfies Record<string, Art>;

export type ArtKey = keyof typeof ART;

/**
 * Short clips that grow out of a trial's picture when the trial is entered
 * (see lib/trial-enter). About two seconds, silent, ending in darkness. A
 * trial without one gets the still picture pushed in instead.
 */
export const ENTER_CLIPS: Partial<Record<ArtKey, string>> = {
  wordle: "/art/wordle-enter-v1.mp4",
  aim: "/art/aim-enter-v1.mp4",
  braziers: "/art/braziers-enter-v1.mp4",
};

export function artSrc(art: Art, width?: number): string {
  if (art.widths.length === 0) return `${art.base}.webp`;
  return `${art.base}-${width ?? art.widths[art.widths.length - 1]}.webp`;
}

export function artSrcSet(art: Art): string | undefined {
  if (art.widths.length === 0) return undefined;
  return art.widths.map((w) => `${artSrc(art, w)} ${w}w`).join(", ");
}
