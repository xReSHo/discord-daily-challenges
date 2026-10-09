/**
 * Moving between pages with a transition instead of a hard cut.
 *
 * Uses the browser's View Transitions: it holds a picture of the page being
 * left on screen while the next one loads, then blends the two (the styles are
 * in globals.css, under "Page transitions"). So an ordinary page change never
 * shows the loading screen — that is kept for loads slow enough to need it:
 * after MAX_HOLD_MS the blend goes ahead with whatever is there, which by then
 * is the loading screen.
 *
 * Browsers without View Transitions, and visitors who ask for reduced motion,
 * get a plain page change.
 */

type Router = { push: (href: string) => void };

/** `fade`: an ordinary link. `up`: carrying on down past the bottom of a page
 *  into the next one. `down`: back up past the top into the one before.
 *  `burn`: the page has already burned through to a picture of the next one
 *  (lib/burn), so all that is left is to swap that picture for the real page. */
export type TransitionMode = "fade" | "up" | "down" | "burn";

/** Longest the old page is held while the new one loads. */
const MAX_HOLD_MS = 1200;

/** Resolves once the app has left `from` and the new page (not its loading
 *  screen) is in the document — or the hold runs out. */
function arrived(from: string): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now();
    const id = window.setInterval(() => {
      const there = location.pathname !== from && !document.querySelector("[data-grace-loader]");
      if (there || performance.now() - started > MAX_HOLD_MS) {
        window.clearInterval(id);
        // start the new page from its very top (the router stops at the first
        // changed element, which leaves the page a header's height down)
        if (there) window.scrollTo(0, 0);
        resolve();
      }
    }, 16);
  });
}

export function go(router: Router, href: string, mode: TransitionMode = "fade") {
  const calm = !window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
  if (calm || typeof document.startViewTransition !== "function") {
    router.push(href);
    return;
  }
  const root = document.documentElement;
  const from = location.pathname;
  root.dataset.vt = mode;
  const transition = document.startViewTransition(() => {
    router.push(href);
    return arrived(from);
  });
  transition.finished.finally(() => {
    delete root.dataset.vt;
  });
}
