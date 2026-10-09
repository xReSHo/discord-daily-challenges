"use client";

import { useEffect, useState } from "react";
import { AchievementIcon, type AchievementToast } from "@/lib/achievements/catalog";
import type { DropToast } from "@/lib/equipment-drops";
import { pieceArt, rarityName } from "@/lib/equipment";
import { play } from "@/lib/sfx";
import styles from "./AchievementToaster.module.css";

const SHOW_MS = 3000;

type Toast = ({ kind: "feat" } & AchievementToast) | ({ kind: "drop"; key: string } & DropToast);

/** Small always-mounted widget (see AppFrame) that announces newly-unlocked
 *  achievements and newly-found equipment. Decoupled from every game's own UI on purpose: whichever
 *  trial (or the weekly boss) actually triggered the unlock, this is the one
 *  place the popup gets shown, on whatever page the player is on when it
 *  polls next. */
export function AchievementToaster() {
  const [queue, setQueue] = useState<Toast[]>([]);
  const current = queue[0] ?? null;

  // Poll for unseen unlocks on mount and whenever the tab regains focus —
  // e.g. coming back from a trial that just finished.
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/achievements/unseen");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { unseen?: AchievementToast[]; drops?: DropToast[] };
        const unseen = data.unseen ?? [];
        const drops = data.drops ?? [];
        if (unseen.length === 0 && drops.length === 0) return;
        setQueue((q) => [
          ...q,
          ...drops.map((d) => ({ kind: "drop" as const, key: d.id, ...d })),
          ...unseen.map((u) => ({ kind: "feat" as const, ...u })),
        ]);
        // Mark seen right away. The in-memory queue is what actually plays
        // the toasts back one at a time; a reload mid-queue can drop a
        // popup, but never the achievement or its reward — both are already
        // durably recorded before this ever fires.
        fetch("/api/achievements/seen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keys: unseen.map((u) => u.key), drops: drops.map((d) => d.id) }),
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
    play(current.kind === "feat" ? "feat" : "found");
    const t = setTimeout(() => setQueue((q) => q.slice(1)), SHOW_MS);
    return () => clearTimeout(t);
  }, [current]);

  if (!current) return null;

  if (current.kind === "drop") {
    return (
      <div className={styles.wrap} role="status" aria-live="polite">
        <div key={current.key} className={`${styles.toast} ${styles.drop} ${styles[current.rarity]}`}>
          <span className={styles.iconWrap}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pieceArt(current.pieceId).src} alt="" width={160} height={160} />
          </span>
          <span className={styles.body}>
            <span className={styles.eyebrow}>{rarityName(current.rarity)} equipment found</span>
            <span className={styles.name}>{current.name}</span>
            <span className={styles.reward}>
              {current.duplicate
                ? `You already own it: +${current.coins.toLocaleString()} coins instead`
                : "Added to your equipment"}
            </span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <div key={current.key} className={styles.toast}>
        <span className={styles.iconWrap}>
          <AchievementIcon name={current.icon} size={20} strokeWidth={1.6} />
        </span>
        <span className={styles.body}>
          <span className={styles.eyebrow}>Achievement unlocked</span>
          <span className={styles.name}>{current.name}</span>
          <span className={styles.reward}>{current.rewardText}</span>
        </span>
      </div>
    </div>
  );
}
