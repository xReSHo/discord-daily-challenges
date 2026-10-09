"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Coins } from "lucide-react";
import styles from "./shop.module.css";

export type WaresTab = {
  id: string;
  label: string;
  /** How many items the shelf holds, and how many the viewer can pay for. */
  count: number;
  affordable: number;
};

/**
 * The shelves, with a filter above them: one shelf at a time, and/or only
 * what the purse covers. The shelves themselves are rendered on the server
 * and passed in; filtering only hides them (see `.wares[data-cat]` in the
 * stylesheet), so nothing is fetched or re-rendered when a filter is pressed.
 */
export function Wares({
  tabs,
  initial,
  children,
}: {
  tabs: WaresTab[];
  initial: string;
  children: ReactNode;
}) {
  const [cat, setCat] = useState(tabs.some((t) => t.id === initial) ? initial : "all");
  const [afford, setAfford] = useState(false);
  const bar = useRef<HTMLDivElement>(null);

  // the bar sticks just under the site header, however tall that is here
  useEffect(() => {
    const header = document.querySelector("header");
    if (!header || !bar.current) return;
    const el = bar.current;
    // on a phone the header scrolls away, and the bar goes to the very top
    const fit = () => {
      const stuck = getComputedStyle(header).position === "sticky";
      el.style.setProperty("--under", `${stuck ? header.getBoundingClientRect().height : 0}px`);
    };
    fit();
    const seen = new ResizeObserver(fit);
    seen.observe(header);
    window.addEventListener("resize", fit);
    return () => {
      seen.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  const n = (t: WaresTab) => (afford ? t.affordable : t.count);
  const all = tabs.reduce((sum, t) => sum + n(t), 0);
  const shown = cat === "all" ? all : n(tabs.find((t) => t.id === cat)!);

  function pick(next: string) {
    setCat(next);
    // keep the address in step, so a shelf can be linked to and survives a reload
    const url = new URL(window.location.href);
    if (next === "all") url.searchParams.delete("show");
    else url.searchParams.set("show", next);
    window.history.replaceState(null, "", url);
  }

  return (
    <>
      <div ref={bar} className={`${styles.filter} rise`}>
        <div className={styles.filterTabs} role="group" aria-label="Show which wares">
          {[{ id: "all", label: "All", count: all, affordable: all }, ...tabs].map((t) => (
            <button
              key={t.id}
              type="button"
              className={styles.filterTab}
              aria-pressed={cat === t.id}
              onClick={() => pick(t.id)}
            >
              {t.label}
              <span>{t.id === "all" ? all : n(t)}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.filterAfford}
          aria-pressed={afford}
          aria-label="Show only what I can afford"
          onClick={() => setAfford((v) => !v)}
        >
          <Coins size={13} /> <span>I can afford</span>
        </button>
      </div>

      <div className={styles.wares} data-cat={cat} data-afford={afford ? "" : undefined}>
        {children}
      </div>

      {shown === 0 && (
        <p className={styles.filterEmpty}>
          Nothing here is within your purse yet.{" "}
          <button type="button" onClick={() => setAfford(false)}>
            Show everything
          </button>
        </p>
      )}
    </>
  );
}
