"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { go, type TransitionMode } from "@/lib/page-transition";

/**
 * Gives every in-app link a page transition (see lib/page-transition).
 *
 * One click listener for the whole document: when a plain left-click lands on
 * a link to another page of this site, the page change is run through the
 * transition instead of the link's own handler. Anything else is left exactly
 * as it was — new-tab and modified clicks, downloads, outside links, links
 * within the same page, and any link marked `data-no-vt`.
 * A link can ask for a particular transition with `data-vt`.
 */
export function PageTransitions() {
  const router = useRouter();

  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      if (ev.defaultPrevented || ev.button !== 0) return;
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      if (!(ev.target instanceof Element)) return;
      const a = ev.target.closest<HTMLAnchorElement>("a[href]");
      if (!a || a.hasAttribute("download") || a.dataset.noVt !== undefined) return;
      if (a.target && a.target !== "_self") return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      if (url.pathname.startsWith("/api/")) return;
      // the link's own handler sees this and stands down
      ev.preventDefault();
      const asked = a.dataset.vt;
      const mode: TransitionMode = asked === "up" || asked === "down" ? asked : "fade";
      go(router, url.pathname + url.search + url.hash, mode);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  return null;
}
