"use client";

import { useEffect, useRef } from "react";
import { play } from "@/lib/sfx";
import styles from "./ClickSpark.module.css";

/**
 * A small spark where the visitor clicks on empty background: a flash, a wide
 * ring of smoke-light that spreads and fades, and the drifting embers nearby
 * (Atmosphere) pushed away from the point. The spark also throws off a few
 * faint motes, and those do not die with the ring: they settle into the
 * background, behind the page, and drift upward for a while like the embers
 * already there.
 *
 * Kept cheap on purpose. Nothing runs between clicks — no animation frame, no
 * timers, one click listener. Everything is a handful of elements animated by
 * the browser's own compositor (transform and opacity only) and removed when
 * its animation ends; the number of motes adrift at once is capped. Clicks on anything that does something — links, buttons,
 * form fields, the games — are left alone, and so is everyone who asks for
 * reduced motion.
 */

/** Clicks on (or inside) any of these are not "the background". */
const NOT_BACKGROUND =
  "a,button,input,textarea,select,label,summary,canvas,video,[role='button'],[contenteditable],.game-stage,[data-no-spark]";

const MOTES = 7;
/** Most motes adrift at once; further clicks still spark but add none. */
const MAX_ADRIFT = 56;
/** How far a click reaches the drifting embers, and how hard it pushes (px). */
const REACH = 260;
const PUSH = 78;
/** Shortest time between two sparks (ms), so frantic clicking stays light. */
const GAP_MS = 140;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

function spark(layer: HTMLElement, behind: HTMLElement, x: number, y: number) {
  const at = document.createElement("div");
  at.className = styles.at;
  at.style.left = `${x}px`;
  at.style.top = `${y}px`;

  const flash = document.createElement("span");
  flash.className = styles.flash;
  const ring = document.createElement("span");
  ring.className = styles.ring;
  at.append(ring, flash);

  layer.append(at);

  // the motes live in the layer behind the page, so they outlast the ring and
  // read as part of the background
  if (behind.childElementCount + MOTES <= MAX_ADRIFT) {
    const turn = Math.random() * Math.PI * 2;
    for (let i = 0; i < MOTES; i++) {
      const m = document.createElement("span");
      m.className = styles.mote;
      const size = rand(2, 3.4);
      m.style.width = m.style.height = `${size}px`;
      m.style.left = `${x}px`;
      m.style.top = `${y}px`;
      // spread evenly round the circle, each nudged so it never looks stamped
      const angle = turn + (i / MOTES) * Math.PI * 2 + rand(-0.35, 0.35);
      const reach = rand(34, 92);
      const dx = Math.cos(angle) * reach;
      const dy = Math.sin(angle) * reach;
      const rise = rand(110, 240);
      const sway = rand(-34, 34);
      const glow = rand(0.32, 0.55);
      behind.append(m);
      const drift = m.animate(
        [
          // thrown outward by the spark…
          { transform: "translate(-50%, -50%)", opacity: 0, easing: "cubic-bezier(0.1, 0.75, 0.25, 1)" },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`, opacity: glow, offset: 0.1, easing: "ease-in-out" },
          // …then adrift: rising slowly and swaying, like the embers around it
          { transform: `translate(calc(-50% + ${dx + sway}px), calc(-50% + ${dy - rise * 0.55}px))`, opacity: glow * 0.8, offset: 0.6, easing: "ease-in" },
          { transform: `translate(calc(-50% + ${dx - sway * 0.4}px), calc(-50% + ${dy - rise}px)) scale(0.5)`, opacity: 0 },
        ],
        { duration: rand(6500, 10500), fill: "forwards" },
      );
      drift.onfinish = drift.oncancel = () => m.remove();
    }
  }

  flash.animate(
    [
      { transform: "translate(-50%, -50%) scale(0.5)", opacity: 0.95 },
      { transform: "translate(-50%, -50%) scale(2.2)", opacity: 0 },
    ],
    { duration: 280, easing: "ease-out", fill: "forwards" },
  );
  const ringAnim = ring.animate(
    [
      { transform: "translate(-50%, -50%) scale(0.04)", opacity: 0.8 },
      { transform: "translate(-50%, -50%) scale(0.55)", opacity: 0.38, offset: 0.4 },
      { transform: "translate(-50%, -50%) scale(1)", opacity: 0 },
    ],
    { duration: 1700, easing: "cubic-bezier(0.15, 0.7, 0.3, 1)", fill: "forwards" },
  );
  ringAnim.onfinish = ringAnim.oncancel = () => at.remove();
}

/** Push the drifting embers near the click away from it; they ease back. */
function scatter(x: number, y: number) {
  for (const el of document.querySelectorAll<HTMLElement>(".ember, [data-motes] > span")) {
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - x;
    const dy = r.top + r.height / 2 - y;
    const d = Math.hypot(dx, dy);
    if (d > REACH) continue;
    const force = Math.pow(1 - d / REACH, 1.4) * PUSH;
    const ux = d ? dx / d : 0;
    const uy = d ? dy / d : -1;
    // `translate` is its own property, so this adds to the ember's rising
    // animation (which uses `transform`) instead of replacing it
    el.animate(
      [
        { translate: "0 0", easing: "cubic-bezier(0.1, 0.8, 0.2, 1)" },
        { translate: `${ux * force}px ${uy * force}px`, offset: 0.2, easing: "ease-in-out" },
        { translate: "0 0" },
      ],
      { duration: 2400 },
    );
  }
}

export function ClickSpark() {
  const ref = useRef<HTMLDivElement>(null);
  const behindRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = ref.current;
    const behind = behindRef.current;
    if (!layer || !behind) return;
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;

    let last = 0;
    const onClick = (ev: MouseEvent) => {
      if (ev.button !== 0 || !(ev.target instanceof Element)) return;
      if (ev.target.closest(NOT_BACKGROUND)) return;
      const now = performance.now();
      if (now - last < GAP_MS) return;
      last = now;
      // push what is already adrift first, so the new motes are not caught in it
      scatter(ev.clientX, ev.clientY);
      spark(layer, behind, ev.clientX, ev.clientY);
      play("spark");
    };
    document.addEventListener("click", onClick, { passive: true });
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <>
      <div ref={behindRef} className={styles.behind} data-motes="" aria-hidden="true" />
      <div ref={ref} className={styles.layer} aria-hidden="true" />
    </>
  );
}
