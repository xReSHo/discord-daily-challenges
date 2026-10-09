"use client";

import { useEffect, useRef } from "react";
import styles from "./GraceLoader.module.css";

/**
 * The loading screen: a site of grace burning in dark ruins, shown like a film
 * frame — the whole scene, edge to edge across the tab, with black bars above
 * and below it and the caption set in the lower bar.
 *
 * It is a short looping clip (public/grace, cached for a year) with a still as
 * its poster. The still paints first, so the screen is never empty, and the
 * clip takes over as soon as it can play; if it never can, the still stays.
 * The clip is shown at its own size or smaller wherever the screen allows, and
 * is never zoomed into — enlarging it is what makes it look soft.
 *
 * Getting it to actually play, everywhere:
 *  - The <video> is written as an HTML string, not JSX. React sets `muted` as a
 *    property rather than an attribute, and browsers only autoplay a video
 *    whose markup says it is muted; as a string the attributes are always
 *    there, whether this arrives in the page's first HTML or is inserted later.
 *  - On a first page load this screen is shown as streamed HTML and replaced
 *    before React ever runs here, so nothing may depend on an effect. The
 *    effect below is only a second attempt for browsers that ignored autoplay.
 *  - Visitors who ask for reduced motion get the still: the sources carry a
 *    media condition, so their browser finds nothing to play.
 *
 * The embers that drift over this screen and scatter from the cursor are drawn
 * by GraceEmbers (root layout), which wakes when it sees `data-grace-loader`.
 *
 * Bump the `-v4` suffix when replacing the files; they are cached as immutable
 * (see next.config.ts), and keep GRACE_* in sync with GracePreload.
 */
export const GRACE_POSTER = "/grace/grace-poster-v4.webp";
export const GRACE_WEBM = "/grace/grace-loop-v4.webm";
export const GRACE_MP4 = "/grace/grace-loop-v4.mp4";

const MOTION_OK = "(prefers-reduced-motion: no-preference)";

// Built only from the constants above — no outside input reaches this string.
const VIDEO_HTML =
  `<video class="${styles.video}" poster="${GRACE_POSTER}" width="1920" height="1080" ` +
  `autoplay muted loop playsinline preload="auto" disablepictureinpicture tabindex="-1" aria-hidden="true">` +
  `<source src="${GRACE_WEBM}" type="video/webm" media="${MOTION_OK}">` +
  `<source src="${GRACE_MP4}" type="video/mp4" media="${MOTION_OK}">` +
  `</video>`;

export function GraceLoader({ label = "Lighting the grace" }: { label?: string }) {
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const v = stage.current?.querySelector("video");
    if (!v || !window.matchMedia(MOTION_OK).matches) return;
    v.muted = true;
    // A refused or interrupted play() leaves the poster showing — nothing to do.
    if (v.paused) v.play().catch(() => {});
  }, []);

  return (
    <div className={styles.screen} role="status" aria-live="polite" data-grace-loader="">
      <div ref={stage} className={styles.stage} dangerouslySetInnerHTML={{ __html: VIDEO_HTML }} />

      <p className={styles.label}>
        <span className={styles.rule} aria-hidden="true" />
        <span className={styles.text}>{label}</span>
        <span className={styles.rule} aria-hidden="true" />
      </p>
    </div>
  );
}
