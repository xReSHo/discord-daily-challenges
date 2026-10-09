"use client";

import { useEffect } from "react";
import { GRACE_MP4, GRACE_POSTER, GRACE_WEBM } from "./GraceLoader";

/** Kept alive for the life of the tab so the browser holds on to the clip. */
let warm: HTMLVideoElement | null = null;

/**
 * Fetches the loading-screen clip once, when the browser is idle after the
 * first page has rendered. A loading screen is usually on screen for well under
 * a second — too short to download its own clip — so without this the first few
 * page changes would only ever show the still. After this, the clip plays from
 * the browser's cache the instant the loader appears.
 *
 * Skipped for visitors who ask for reduced motion (they never see the clip)
 * and for those on a data-saving connection.
 */
export function GracePreload() {
  useEffect(() => {
    if (warm) return;
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;

    const start = () => {
      if (warm) return;
      new Image().src = GRACE_POSTER;
      const v = document.createElement("video");
      v.muted = true;
      v.preload = "auto";
      v.src = v.canPlayType("video/webm") ? GRACE_WEBM : GRACE_MP4;
      v.load();
      warm = v;
    };

    const idle = window.requestIdleCallback;
    if (idle) {
      const id = idle(start, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(start, 1500);
    return () => window.clearTimeout(id);
  }, []);

  return null;
}
