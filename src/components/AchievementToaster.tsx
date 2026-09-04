"use client";

import { useEffect, useState } from "react";
import { ACHIEVEMENTS, rewardLine, type AchievementDef } from "@/lib/achievements/catalog";
import styles from "./AchievementToaster.module.css";

const SHOW_MS = 3000;

/** Small always-mounted widget (see AppFrame) that announces newly-unlocked
 *  achievements. Decoupled from every game's own UI on purpose: whichever
 *  trial (or the weekly boss) actually triggered the unlock, this is the one
 *  place the popup gets shown, on whatever page the player is on when it
 *  polls next. */
export function AchievementToaster() {
  const [queue, setQueue] = useState<AchievementDef[]>([]);
  const current = queue[0] ?? null;

  // Poll for unseen unlocks on mount and whenever the tab regains focus —
  // e.g. coming back from a trial that just finished.
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/achievements/unseen");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { keys: string[] };
        if (data.keys.length === 0) return;
        const defs = data.keys
          .map((k) => ACHIEVEMENTS.find((a) => a.key === k))
          .filter((d): d is AchievementDef => d != null);
        if (defs.length === 0) return;
        setQueue((q) => [...q, ...defs]);
        // Mark seen right away. The in-memory queue is what actually plays
        // the toasts back one at a time; a reload mid-queue can drop a
        // popup, but never the achievement or its reward — both are already
        // durably recorded before this ever fires.
        fetch("/api/achievements/seen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keys: data.keys }),
        }).catch(() => {});
      } catch {
        /* a missed toast isn't worth surfacing an error for */
      }
    }

    void poll();
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Advance the queue once the current toast has had its full showing —
  // the CSS animation on the toast itself is timed to the same duration, so
  // it fades out right as this unmounts it.
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), SHOW_MS);
    return () => clearTimeout(t);
  }, [current]);

  if (!current) return null;
  const Icon = current.icon;

  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <div key={current.key} className={styles.toast}>
        <span className={styles.iconWrap}>
          <Icon size={20} strokeWidth={1.6} />
        </span>
        <span className={styles.body}>
          <span className={styles.eyebrow}>Achievement unlocked</span>
          <span className={styles.name}>{current.name}</span>
          <span className={styles.reward}>{rewardLine(current.reward)}</span>
        </span>
      </div>
    </div>
  );
}
