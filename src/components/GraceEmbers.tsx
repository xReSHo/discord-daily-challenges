"use client";

import { useEffect, useRef } from "react";
import styles from "./GraceEmbers.module.css";

/**
 * Embers that float in front of the loading screen and scatter from the cursor.
 *
 * This lives in the root layout rather than inside the loading screen on
 * purpose. On a first page load the loading screen is streamed HTML that is
 * swapped out before React ever runs inside it, so nothing interactive can live
 * there. The root layout, by contrast, is running from the first moment — so
 * this component sits idle (a hidden canvas, no animation frame) and wakes only
 * while an element marked `data-grace-loader` is in the page.
 *
 * Kept deliberately cheap:
 *  - Asleep, it costs nothing: no animation frame, no timers, and no watching
 *    of the page. It is woken by the loading screen's own fade-in animation
 *    (one `animationstart` listener) and puts itself back to sleep on the first
 *    frame after the loader has gone.
 *  - Awake, it draws a few dozen pre-rendered glows per frame onto a canvas at
 *    one pixel per CSS pixel (the glows are soft, extra resolution buys
 *    nothing), at no more than 60 frames a second however fast the display is.
 *  - It never starts for visitors who ask for reduced motion.
 */

type Ember = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** resting upward speed and sideways sway this ember returns to */
  rise: number;
  sway: number;
  swaySpeed: number;
  phase: number;
  size: number;
  alpha: number;
  twinkle: number;
};

const LOADER = "[data-grace-loader]";
/** Reach of the cursor, and how hard it pushes, in CSS pixels. */
const REACH = 150;
const PUSH = 1.5;
/** One ember per this many square pixels of screen, within MIN..MAX. */
const AREA_PER_EMBER = 36000;
const MIN_EMBERS = 14;
const MAX_EMBERS = 46;
/** Shortest time between drawn frames (ms): caps the work at ~60 fps. */
const FRAME_MS = 1000 / 61;

/** One soft glowing dot, drawn once and stamped for every ember. */
function makeSprite(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255, 246, 220, 1)");
  grad.addColorStop(0.16, "rgba(246, 210, 122, 0.95)");
  grad.addColorStop(0.42, "rgba(214, 160, 62, 0.28)");
  grad.addColorStop(1, "rgba(200, 140, 40, 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

export function GraceEmbers() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    // non-null handles for the hoisted stop() below
    const cv = canvas;
    const g = ctx;

    const sprite = makeSprite();
    let embers: Ember[] = [];
    let w = 0;
    let h = 0;
    let frame = 0;
    let last = 0;
    let fade = 0; // 0 → 1 as the embers appear
    let running = false;
    let loader: Element | null = null;
    // cursor position and how fast it is moving; far off-screen when unknown
    const cursor = { x: -9999, y: -9999, vx: 0, vy: 0, at: 0 };

    const spawn = (anywhere: boolean): Ember => ({
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + 12,
      vx: 0,
      vy: 0,
      rise: 9 + Math.random() * 26,
      sway: 5 + Math.random() * 14,
      swaySpeed: 0.3 + Math.random() * 0.9,
      phase: Math.random() * Math.PI * 2,
      size: 1.4 + Math.random() * Math.random() * 5.2,
      alpha: 0.25 + Math.random() * 0.6,
      twinkle: 0.6 + Math.random() * 2.2,
    });

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w;
      canvas.height = h;
      const want = Math.max(MIN_EMBERS, Math.min(MAX_EMBERS, Math.round((w * h) / AREA_PER_EMBER)));
      while (embers.length < want) embers.push(spawn(true));
      embers.length = want;
    };

    const tick = (now: number) => {
      if (!running) return;
      // the loading screen has gone: go back to sleep
      if (!loader?.isConnected) return stop();
      frame = requestAnimationFrame(tick);
      // a 120/144/165 Hz display would otherwise redraw two or three times as often
      if (now - last < FRAME_MS) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      fade = Math.min(1, fade + dt * 1.6);
      // a cursor that has stopped no longer carries any momentum
      if (now - cursor.at > 80) cursor.vx = cursor.vy = 0;

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      const t = now / 1000;

      for (const e of embers) {
        // drift: ease back toward this ember's own slow rise and sway
        const restX = Math.sin(t * e.swaySpeed + e.phase) * e.sway;
        e.vx += (restX - e.vx) * Math.min(1, dt * 2.2);
        e.vy += (-e.rise - e.vy) * Math.min(1, dt * 2.2);

        // scatter: pushed away from the cursor, harder the closer it is, and
        // swept along a little by the cursor's own movement
        const dx = e.x - cursor.x;
        const dy = e.y - cursor.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < REACH * REACH) {
          const d = Math.sqrt(d2) || 1;
          const near = 1 - d / REACH;
          const force = near * near * PUSH * 60;
          e.vx += (dx / d) * force + cursor.vx * near * 0.05;
          e.vy += (dy / d) * force + cursor.vy * near * 0.05;
        }

        e.x += e.vx * dt;
        e.y += e.vy * dt;

        // off the top or far off a side: return from below
        if (e.y < -14 || e.x < -40 || e.x > w + 40 || e.y > h + 40) {
          Object.assign(e, spawn(false));
        }

        const glow = 0.72 + 0.28 * Math.sin(t * e.twinkle + e.phase);
        ctx.globalAlpha = e.alpha * glow * fade;
        const s = e.size * 2.6;
        ctx.drawImage(sprite, e.x - s, e.y - s, s * 2, s * 2);
      }
      ctx.globalAlpha = 1;
    };

    const onMove = (ev: PointerEvent) => {
      const now = performance.now();
      const dt = Math.max(1, now - cursor.at);
      if (cursor.x > -9000) {
        cursor.vx = ((ev.clientX - cursor.x) / dt) * 1000;
        cursor.vy = ((ev.clientY - cursor.y) / dt) * 1000;
      }
      cursor.x = ev.clientX;
      cursor.y = ev.clientY;
      cursor.at = now;
    };
    const onLeave = () => {
      cursor.x = cursor.y = -9999;
      cursor.vx = cursor.vy = 0;
    };

    const start = (el: Element) => {
      loader = el;
      if (running) return;
      running = true;
      fade = 0;
      embers = [];
      resize();
      canvas.dataset.on = "1";
      window.addEventListener("resize", resize);
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
      last = performance.now() - FRAME_MS;
      frame = requestAnimationFrame(tick);
    };

    function stop() {
      if (!running) return;
      running = false;
      loader = null;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      delete cv.dataset.on;
      g.clearRect(0, 0, w, h);
      embers = [];
    }

    // Wake when a loading screen starts its fade-in. That animation is the
    // signal, so nothing has to watch the page for the loader being added.
    const onAnimation = (ev: AnimationEvent) => {
      if (ev.target instanceof Element && ev.target.matches(LOADER)) start(ev.target);
    };
    document.addEventListener("animationstart", onAnimation);
    // …and one already on screen when this first runs (a first page load).
    const present = document.querySelector(LOADER);
    if (present) start(present);

    return () => {
      document.removeEventListener("animationstart", onAnimation);
      stop();
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.embers} aria-hidden="true" />;
}
