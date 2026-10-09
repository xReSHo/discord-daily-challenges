"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronsDown } from "lucide-react";
import { createBurn, type Burn } from "@/lib/burn";
import { play } from "@/lib/sfx";
import type { FlowStop } from "@/lib/page-flow";
import { go } from "@/lib/page-transition";
import styles from "./PageFlow.module.css";

/**
 * Leads from one main page into its neighbours by scrolling.
 *
 * Pushing on past the bottom of a page burns it away to show the next one
 * behind it; past the top, the one before (see lib/burn for the fire). The
 * burn itself is the measure of how far there is to go. At the foot of the page
 * a single quiet line names the page that carrying on leads to; it can simply
 * be clicked.
 *
 * What counts as "meaning it" — the whole point is that nobody is carried to
 * another page by accident:
 *  - Only pushes made while resting at the edge count. The page must have been
 *    at the edge for a moment first (EDGE_DWELL_MS), and the push must be a new
 *    gesture, so scrolling down a page and running into the bottom does nothing.
 *  - The glide that carries on after the fingers leave a trackpad, or after a
 *    wheel is flicked, does not count: its steps get steadily smaller, and only
 *    steps that hold or grow are counted. Stop pushing and the burn stops.
 *  - It takes several separate steps over a short time (MIN_STEPS, MIN_MS), and
 *    one step can only add so much, so a single large jolt cannot do it.
 *  - Left alone, the holes close again within about a second.
 *  - On a touch screen it follows the finger and only acts on letting go, so
 *    dragging back cancels it.
 *
 * Kept light: nothing is set up until the first push, and a neighbouring page is fetched ahead of time only at the
 * first movement towards it from the edge — not on every page view — so it is
 * usually ready by the time the page has burned through.
 */

/** How much pushing past the edge it takes (wheel px / finger px). */
const PULL_PX = 520;
/** The most a single wheel step may add. */
const STEP_MAX_PX = 150;
/** At least this many counted steps, over at least this long. */
const MIN_STEPS = 3;
const MIN_MS = 220;
/** The page must have rested at the edge this long before a push counts. */
const EDGE_DWELL_MS = 320;
/** A pause this long in the wheel events means a new gesture has begun. */
const GESTURE_GAP_MS = 170;
/** How soon after the last counted step the burn starts to heal, and how long
 *  healing takes: whole again about a second after the visitor stops. */
const DRAIN_AFTER_MS = 220;
const DRAIN_MS = 780;

type Edge = {
  stop: FlowStop;
  mode: "up" | "down";
  at: () => boolean;
  warm: () => void;
  pull: number;
  armed: boolean;
  /** when the page came to rest at this edge (0 = not at it) */
  since: number;
  warmed: boolean;
  steps: number;
  first: number;
  lastStep: number;
  drain: number;
};

const atTop = () => window.scrollY <= 1;
const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;

export function PageFlow({ prev, next }: { prev?: FlowStop; next?: FlowStop }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** set by the effect: burn through to the next page at once (a click) */
  const burnNow = useRef<(() => void) | null>(null);
  // fetch a neighbour ahead of time only once the visitor starts towards it
  const [warmPrev, setWarmPrev] = useState(false);
  const [warmNext, setWarmNext] = useState(false);
  // the stops are plain data from the server; key the effect on what they say
  const prevKey = prev ? JSON.stringify(prev) : "";
  const nextKey = next ? JSON.stringify(next) : "";

  useEffect(() => {
    let gone = false;
    let lastWheel = 0;
    const make = (key: string, mode: Edge["mode"]): Edge | null =>
      key
        ? {
            stop: JSON.parse(key) as FlowStop,
            mode,
            at: mode === "up" ? atBottom : atTop,
            warm: mode === "up" ? () => setWarmNext(true) : () => setWarmPrev(true),
            pull: 0,
            armed: false,
            since: 0,
            warmed: false,
            steps: 0,
            first: 0,
            lastStep: 0,
            drain: 0,
          }
        : null;
    // scrolling down leads "up" into the next page; scrolling up, "down" into the last
    const down = make(nextKey, "up");
    const up = make(prevKey, "down");
    if (!down && !up) return;

    // the fire is only set up when it is first needed; `false` = cannot (no
    // WebGL, or the visitor asks for reduced motion) and the slide is used
    let burn: Burn | null | false = null;
    const fire = (): Burn | null => {
      if (burn === null) {
        const calm = !window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
        burn = (!calm && canvasRef.current && createBurn(canvasRef.current)) || false;
      }
      return burn || null;
    };
    // note when the page comes to rest at an edge, and when it leaves
    const settle = () => {
      const now = performance.now();
      for (const e of [down, up]) {
        if (!e) continue;
        if (e.at()) e.since ||= now;
        else if (e.since) {
          e.since = 0;
          reset(e);
        }
      }
    };

    const show = (e: Edge) => {
      const p = Math.min(1, e.pull / PULL_PX);
      // nothing of the fire exists until there is something to burn
      if (p > 0 || burn) fire()?.aim(e.stop, p);
    };
    const reset = (e: Edge | null) => {
      if (!e) return;
      window.clearTimeout(e.drain);
      e.armed = false;
      e.steps = 0;
      if (e.pull) {
        e.pull = 0;
        show(e);
      }
    };
    const leave = (e: Edge, ms?: number) => {
      if (gone) return;
      gone = true;
      window.clearTimeout(e.drain);
      e.pull = PULL_PX;
      const f = fire();
      // burn what is left of the page, then swap the picture for the real thing
      if (f) {
        play("burn");
        f.finish(e.stop, ms).then(() => go(router, e.stop.href, "burn"));
      }
      else go(router, e.stop.href, e.mode);
    };
    burnNow.current = down
      ? () => {
          down.warm();
          leave(down, 650);
        }
      : null;
    const ebb = (e: Edge) => {
      window.clearTimeout(e.drain);
      e.drain = window.setTimeout(function step() {
        e.pull = Math.max(0, e.pull - (PULL_PX / DRAIN_MS) * 30);
        show(e);
        if (e.pull > 0) e.drain = window.setTimeout(step, 30);
        else e.steps = 0;
      }, DRAIN_AFTER_MS);
    };

    const onWheel = (ev: WheelEvent) => {
      if (gone || ev.ctrlKey || ev.deltaY === 0) return;
      const now = performance.now();
      const fresh = now - lastWheel > GESTURE_GAP_MS;
      lastWheel = now;
      const e = ev.deltaY > 0 ? down : up;
      // turning back the other way cancels what was building
      reset(ev.deltaY > 0 ? up : down);
      if (!e) return;
      if (!e.at()) {
        e.since = 0;
        reset(e);
        return;
      }
      e.since ||= now;
      if (!e.warmed) {
        // the first movement towards a neighbour: start fetching it now, well
        // before the push can complete
        e.warmed = true;
        e.warm();
      }
      // deltaMode 1 = lines (Firefox with a mouse): about 30 px a line
      const size = Math.abs(ev.deltaY) * (ev.deltaMode === 1 ? 30 : 1);
      const fading = size < e.lastStep * 0.9;
      e.lastStep = size;
      // a push counts only if it begins while resting at the edge
      if (fresh && now - e.since >= EDGE_DWELL_MS) e.armed = true;
      // ...and the fading tail of a glide never does
      if (!e.armed || (fading && !fresh)) return;

      if (e.pull === 0) {
        e.first = now;
        e.steps = 0;
        if (fire()) play("kindle");
      }
      e.pull += Math.min(size, STEP_MAX_PX);
      e.steps++;
      show(e);
      if (e.pull >= PULL_PX && e.steps >= MIN_STEPS && now - e.first >= MIN_MS) return leave(e);
      e.pull = Math.min(e.pull, PULL_PX);
      ebb(e);
    };

    // touch: the strip follows the finger and acts only on letting go
    let touch: { y: number; e: Edge | null; other: Edge | null } | null = null;
    const onTouchStart = (ev: TouchEvent) => {
      if (gone || ev.touches.length !== 1) return (touch = null);
      touch = { y: ev.touches[0].clientY, e: null, other: null };
    };
    const onTouchMove = (ev: TouchEvent) => {
      if (!touch || gone) return;
      const moved = touch.y - ev.touches[0].clientY; // > 0: finger up, page down
      if (!touch.e) {
        const e = moved > 0 ? down : up;
        // decide once the finger has clearly set off, and only from the edge
        if (Math.abs(moved) < 12) return;
        if (!e || !e.at()) return (touch = null);
        touch.e = e;
        touch.y = ev.touches[0].clientY;
        e.warm();
        if (fire()) play("kindle");
        return;
      }
      const e = touch.e;
      const towards = e === down ? moved : -moved;
      e.pull = e.at() ? Math.max(0, Math.min(PULL_PX, towards * 2.2)) : 0;
      show(e);
    };
    const onTouchEnd = () => {
      const e = touch?.e;
      touch = null;
      if (!e) return;
      if (e.pull >= PULL_PX) leave(e);
      else reset(e);
    };

    // pulling down at the top would otherwise be the browser's own
    // pull-to-refresh, fighting this one
    const root = document.documentElement;
    const before = root.style.overscrollBehaviorY;
    if (up) root.style.overscrollBehaviorY = "contain";

    window.addEventListener("wheel", onWheel, { passive: true });
    // (leaving the edge by any means — keyboard, scrollbar — forgets a push)
    window.addEventListener("scroll", settle, { passive: true });
    settle();
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      burnNow.current = null;
      if (burn) burn.dispose();
      for (const e of [down, up]) if (e) window.clearTimeout(e.drain);
      root.style.overscrollBehaviorY = before;
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("scroll", settle);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [prevKey, nextKey, router]);

  return (
    <>
      {/* the fire: drawn over the page, under the site header */}
      <canvas ref={canvasRef} className={styles.fire} aria-hidden="true" />
      {prev && (
        // Not something to see or use: a link is what fetches a whole page
        // ahead of time, so this one stands in for the page above, which has
        // no strip of its own. It does nothing until the first pull upward.
        <Link href={prev.href} prefetch={warmPrev} className={styles.ahead} tabIndex={-1} aria-hidden="true" data-no-vt="" />
      )}
      {next && (
        <nav className={styles.onward} aria-label="Next page">
          {/* a click burns straight through; without script it is a plain link */}
          <Link
            href={next.href}
            className={styles.link}
            data-no-vt=""
            prefetch={warmNext}
            onClick={(ev) => {
              if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
              if (!burnNow.current) return;
              ev.preventDefault();
              burnNow.current();
            }}
          >
            <span className={styles.rule} aria-hidden="true" />
            <span className={styles.words}>
              <span className={styles.lead}>Onward</span>
              <span className={styles.name}>{next.eyebrow}</span>
            </span>
            <ChevronsDown size={15} className={styles.chevrons} aria-hidden="true" />
            <span className={styles.rule} aria-hidden="true" />
          </Link>
        </nav>
      )}
    </>
  );
}
