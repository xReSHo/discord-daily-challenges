"use client";

import { memo, useMemo, useState } from "react";
import { Coins } from "lucide-react";
import type { BossState, BossLeader } from "@/lib/boss/types";
import styles from "./boss.module.css";

export function fmtDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

// portrait is a `button` when hittable so it can hold the imperative hurt ref
export const BossPortrait = memo(function BossPortrait({
  ref,
  image,
  name,
  onHit,
  dimmed,
  fallen,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  image: string;
  name: string;
  onHit?: () => void;
  dimmed?: boolean;
  fallen?: boolean;
}) {
  const cls = [
    styles.portrait,
    dimmed ? styles.dimmed : "",
    fallen ? styles.fallen : "",
    onHit ? styles.hittable : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <picture>
      <source srcSet={`${image}.webp`} type="image/webp" />
      <img src={`${image}.png`} alt={name} draggable={false} />
    </picture>
  );

  if (!onHit) return <div className={cls}>{content}</div>;
  return (
    <button
      ref={ref}
      type="button"
      className={cls}
      onPointerDown={(e) => {
        e.preventDefault();
        onHit();
      }}
      aria-label={`Strike ${name}`}
    >
      {content}
      <span className={styles.hitRing} aria-hidden />
    </button>
  );
});

export function AdminBar({ show, active }: { show: boolean; active: boolean }) {
  const [despawning, setDespawning] = useState(false);
  if (!show) return null;
  return (
    <span className={styles.adminBar}>
      <a href="/admin/boss" className={styles.adminLink}>
        Boss control →
      </a>
      {active && (
        <button
          type="button"
          className={styles.despawnBtn}
          disabled={despawning}
          onClick={() => {
            setDespawning(true);
            fetch("/api/boss/despawn", { method: "POST" }).finally(() =>
              window.location.reload(),
            );
          }}
        >
          {despawning ? "Despawning…" : "Despawn (test)"}
        </button>
      )}
    </span>
  );
}

export function Outcome({ state }: { state: BossState }) {
  if (state.yourDamage <= 0) {
    return <p className={styles.sub}>You didn&apos;t join this fight.</p>;
  }
  if (state.yourPayout === null) {
    return (
      <p className={styles.sub}>
        You dealt {state.yourDamage.toLocaleString()} damage — the{" "}
        {state.slain ? "bounty" : "tally"} is being settled.
      </p>
    );
  }
  if (state.yourPayout >= 0) {
    return (
      <p className={`${styles.sub} ${styles.won}`}>
        <Coins size={14} /> +{state.yourPayout.toLocaleString()} coins for{" "}
        {state.yourDamage.toLocaleString()} damage.
      </p>
    );
  }
  return (
    <p className={`${styles.sub} ${styles.lost}`}>
      {state.yourPayout.toLocaleString()} coins — you fought and {state.name}{" "}
      lived.
    </p>
  );
}

export const Leaderboard = memo(function Leaderboard({
  top,
}: {
  top: BossLeader[];
}) {
  const rows = useMemo(() => top, [top]);
  if (rows.length === 0) return null;
  return (
    <ol className={styles.board}>
      {rows.map((l) => (
        <li key={l.rank} className={l.you ? styles.youRow : undefined}>
          <span className={styles.rank}>{l.rank}</span>
          <span className={styles.who}>{l.name}</span>
          <span className={`mono ${styles.dmg}`}>{l.damage.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
});
