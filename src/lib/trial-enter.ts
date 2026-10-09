/**
 * Entering a trial from the dashboard: the trial's picture leaves its banner,
 * grows to fill the window while a short clip plays out of it (the stone grid
 * catching fire, the shield being struck), ends in darkness, and the trial is
 * there when the darkness lifts.
 *
 * The picture is a layer of its own on top of the whole page, outside the app,
 * so it stays put while the page underneath is swapped for the trial. The swap
 * happens once the picture covers the window, and the rest of the clip covers
 * the wait (the trial's page was fetched ahead when the banner was pointed at).
 *
 * Without a clip (or if it has not loaded in time) the still picture is pushed
 * in and darkened instead, which is shorter.
 */

import { play } from "@/lib/sfx";

type Router = { push: (href: string) => void };

const DARK = "#0a0908";
const GROW_MS = 620;
/** The still-only version: how long the picture pushes in before the dark. */
const STILL_MS = 900;
/** Longest the dark is held for a trial that is slow to arrive. */
const MAX_WAIT_MS = 2500;
const LIFT_MS = 460;

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function fill(el: HTMLElement) {
  Object.assign(el.style, { position: "absolute", inset: "0", width: "100%", height: "100%" });
}

/** Resolves when the app is on `path` with its page (not the loading screen)
 *  in the document, or after `max` ms. */
function arrived(path: string, max: number): Promise<boolean> {
  return new Promise((resolve) => {
    const started = performance.now();
    const id = window.setInterval(() => {
      const there = location.pathname === path && !document.querySelector("[data-grace-loader]");
      if (there || performance.now() - started > max) {
        window.clearInterval(id);
        resolve(there);
      }
    }, 30);
  });
}

/** True when this visitor should get the plain page change instead. */
export function calm(): boolean {
  return !window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
}

let running = false;

export async function enterTrial(router: Router, href: string, gate: HTMLElement, clip: HTMLVideoElement | null) {
  if (running) return;
  running = true;
  play("enter");

  const art = gate.querySelector<HTMLElement>("[data-gate-art]") ?? gate;
  const img = art.querySelector("img");
  const from = art.getBoundingClientRect();

  const veil = document.createElement("div");
  veil.setAttribute("aria-hidden", "true");
  Object.assign(veil.style, {
    position: "fixed",
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    // above everything, the loading screen included
    zIndex: "2147483000",
    overflow: "hidden",
    background: DARK,
    contain: "strict",
  });

  const still = document.createElement("img");
  if (img) {
    still.src = img.currentSrc || img.src;
    still.style.objectPosition = img.style.objectPosition;
  }
  still.alt = "";
  fill(still);
  still.style.objectFit = "cover";
  veil.append(still);

  const playable = !!clip && clip.readyState >= 3;
  if (clip && playable) {
    fill(clip);
    Object.assign(clip.style, { objectFit: "cover", opacity: "0" });
    veil.append(clip);
  }

  const dark = document.createElement("div");
  fill(dark);
  Object.assign(dark.style, { background: DARK, opacity: "0" });
  veil.append(dark);

  document.body.append(veil);

  // The trial starts loading as soon as the picture covers the window — not
  // before, or the page would change around the picture while it grows.
  window.setTimeout(() => router.push(href), GROW_MS);

  veil.animate(
    [
      { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` },
      { left: "0px", top: "0px", width: "100vw", height: "100vh" },
    ],
    { duration: GROW_MS, easing: "cubic-bezier(0.3, 0, 0.1, 1)", fill: "forwards" },
  );

  if (clip && playable) {
    clip.currentTime = 0;
    const ended = new Promise<void>((r) => clip.addEventListener("ended", () => r(), { once: true }));
    try {
      await clip.play();
      clip.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, fill: "forwards" });
      // the clip ends in darkness of its own accord
      await Promise.race([ended, wait(clip.duration * 1000 + 400)]);
    } catch {
      // not allowed to play after all: fall through to the dark
    }
    dark.style.opacity = "1";
  } else {
    still.animate([{ transform: "scale(1)" }, { transform: "scale(1.22)" }], {
      duration: STILL_MS,
      easing: "cubic-bezier(0.4, 0, 0.9, 0.6)",
      fill: "forwards",
    });
    dark.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: STILL_MS * 0.55,
      delay: STILL_MS * 0.45,
      easing: "ease-in",
      fill: "forwards",
    });
    await wait(STILL_MS);
  }

  const there = await arrived(new URL(href, location.href).pathname, MAX_WAIT_MS);
  if (there) window.scrollTo(0, 0);

  await veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: LIFT_MS, easing: "ease-out", fill: "forwards" })
    .finished;
  veil.remove();
  running = false;
}
