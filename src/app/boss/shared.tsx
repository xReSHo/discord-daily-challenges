"use client";

import { memo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Coins, Skull, Swords, Timer, Users } from "lucide-react";
import type { BossState, BossLeader } from "@/lib/boss/types";
import { ArtImage } from "@/components/ArtImage";
import { Spoils } from "@/components/Spoils";
import { KitBar, kitShows } from "./KitBar";
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

/** 12,345 for whole numbers, one decimal while a figure is still small. */
function fmtDamage(n: number): string {
  return n >= 100 ? Math.round(n).toLocaleString("en-US") : (Math.round(n * 10) / 10).toLocaleString("en-US");
}

/**
 * The raid's whole screen. The boss stands in the middle of it, as tall as the
 * window allows, against the raid's artwork; everything else is arranged
 * around him: where the fight stands down the left, who is hitting hardest
 * down the right, and along the foot his name and health in one long bar.
 *
 * Every state of the raid (waiting, fighting, over) and every way of fighting
 * (see BossArena) is drawn inside this, so the page never changes shape.
 */
export function Stage({
  state,
  eyebrow,
  hp,
  mine,
  clock,
  notice,
  focus = false,
  onUse,
  beforeUse,
  children,
}: {
  state: BossState;
  eyebrow: string;
  /** health to show; leave out to show no bar (the raid has not begun) */
  hp?: number;
  /** the viewer's own damage so far */
  mine?: number;
  /** the one time that matters now: until it ends, begins, or the next one */
  clock: { label: string; ms: number };
  /** a line or band just above the name: how to fight, the phase, the result */
  notice?: React.ReactNode;
  /** a trial is being played in the middle: everything else stands back */
  focus?: boolean;
  /** given while the raid is being fought: the fighter's shop gear is shown,
   *  and this takes the fight as it stands after something is used */
  onUse?: (next: BossState) => void;
  /** send any strikes still in hand before something is used */
  beforeUse?: () => Promise<void> | void;
  /** the middle of the stage: the boss himself, or what he is fought through */
  children: React.ReactNode;
}) {
  const pct = hp === undefined ? 0 : Math.max(0, Math.min(100, (hp / state.maxHp) * 100));
  return (
    <section
      className={`${styles.stage} ${focus ? styles.stageFocus : ""}`}
      data-status={state.status}
      // the fighter's gear takes a band of the foot: the boss stands a little shorter
      data-kit={(onUse && !focus && kitShows(state, Date.parse(state.expiresAt) - clock.ms)) || undefined}
    >
      <div className={styles.backdrop} aria-hidden="true">
        <ArtImage art="boss" sizes="100vw" eager className={styles.backdropImg} />
      </div>

      <div className={styles.stageInner}>
        <header className={styles.top}>
          <Link href="/dashboard" className={styles.back}>
            <ArrowLeft size={14} /> All trials
          </Link>
          <p className={styles.kicker}>{eyebrow}</p>
          <AdminBar show={state.viewerIsAdmin} active={state.status === "active"} />
        </header>

        {state.status === "active" && (state.adminOnly || !state.paysOut) && (
          <p className={styles.testFlag}>
            {state.adminOnly && "Only admins can see this fight. "}
            {!state.paysOut && "No coins are paid out for it."}
          </p>
        )}

        {/* where the fight stands */}
        <aside className={styles.railL}>
          <div className={styles.fact}>
            <span className={styles.factLabel}>
              <Timer size={12} /> {clock.label}
            </span>
            <span className={`${styles.factValue} ${styles.factClock}`}>{fmtDuration(clock.ms)}</span>
          </div>
          {mine !== undefined && (
            <div className={styles.fact}>
              <span className={styles.factLabel}>
                <Swords size={12} /> Your damage
              </span>
              <span className={styles.factValue}>{fmtDamage(mine)}</span>
            </div>
          )}
          <div className={styles.fact}>
            <span className={styles.factLabel}>
              <Users size={12} /> Fighters
            </span>
            <span className={styles.factValue}>{state.participants}</span>
          </div>
          <Spoils source="boss" className={styles.spoils} />
        </aside>

        <div className={styles.centre}>{children}</div>

        {/* who is hitting hardest */}
        <aside className={styles.railR}>
          <Leaderboard top={state.top} />
        </aside>

        <footer className={styles.foot}>
          {notice}
          <h1 className={styles.name}>{state.name}</h1>
          {hp !== undefined && (
            <div className={styles.hp} data-low={pct < 25 || undefined}>
              <div className={styles.hpBar} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                <div className={styles.hpFill} style={{ transform: `scaleX(${pct / 100})` }} />
              </div>
              <div className={styles.hpText}>
                <span>
                  {Math.ceil(hp).toLocaleString("en-US")} <small>/ {state.maxHp.toLocaleString("en-US")}</small>
                </span>
                <span>{pct < 1 && pct > 0 ? "<1" : Math.round(pct)}%</span>
              </div>
            </div>
          )}
          {onUse && !focus && <KitBar state={state} onState={onUse} beforeUse={beforeUse} />}
          <p className={styles.stakes}>
            <span>
              <Coins size={13} /> <b>{state.rewardPool.toLocaleString("en-US")}</b> bounty, split by damage
            </span>
            <span>
              <Skull size={13} /> every player loses <b>{state.penaltyEach.toLocaleString("en-US")}</b> if it survives
            </span>
          </p>
        </footer>
      </div>
    </section>
  );
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
  if (!show) return <span className={styles.adminBar} />;
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

/** How the raid ended for the viewer, as one line. */
export function Outcome({ state }: { state: BossState }) {
  if (state.yourPayout !== null && state.yourPayout < 0) {
    return (
      <p className={`${styles.sub} ${styles.lost}`}>
        {state.yourPayout.toLocaleString("en-US")} coins — {state.name} lived, and every player pays.
      </p>
    );
  }
  if (state.yourDamage <= 0) {
    return <p className={styles.sub}>You didn&apos;t join this fight.</p>;
  }
  if (state.yourPayout === null) {
    return (
      <p className={styles.sub}>
        You dealt {fmtDamage(state.yourDamage)} damage — the {state.slain ? "bounty" : "tally"} is being settled.
      </p>
    );
  }
  return (
    <p className={`${styles.sub} ${styles.won}`}>
      <Coins size={14} /> +{state.yourPayout.toLocaleString("en-US")} coins for {fmtDamage(state.yourDamage)} damage.
    </p>
  );
}

export const Leaderboard = memo(function Leaderboard({ top }: { top: BossLeader[] }) {
  const lead = top[0]?.damage ?? 0;
  return (
    <div className={styles.board}>
      <p className={styles.boardTitle}>Top damage</p>
      {top.length === 0 ? (
        <p className={styles.boardEmpty}>No one has struck yet.</p>
      ) : (
        <ol>
          {top.map((l) => (
            <li key={l.rank} className={l.you ? styles.youRow : undefined}>
              <span className={styles.rank}>{l.rank}</span>
              <span className={styles.who}>{l.name}</span>
              <span className={styles.dmg}>{fmtDamage(l.damage)}</span>
              {/* each fighter's share of the leader's damage */}
              <span className={styles.share} style={{ transform: `scaleX(${lead > 0 ? l.damage / lead : 0})` }} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
});

/**
 * The band under a boss that shows a fighter their combo: what it is called
 * on the left, how far along it is in the middle (a bar, or a row of pips),
 * and what it multiplies their damage by on the right. Each boss gives it its
 * own colour (`tone`) and its own words; the shape stays the same so a fighter
 * always knows where to look.
 */
export function ComboBand({
  tone,
  label,
  bar,
  pips,
  mult,
  note = "damage",
  live = false,
  peak = false,
  hint,
}: {
  tone: "fury" | "breath" | "corona" | "threads";
  label: React.ReactNode;
  /** 0..1 — draws a bar */
  bar?: number;
  /** draws `of` pips with the first `lit` alight (instead of a bar) */
  pips?: { lit: number; of: number };
  mult: number;
  note?: string;
  /** the combo is doing something right now */
  live?: boolean;
  /** it is as high as it goes */
  peak?: boolean;
  /** one line under the band: how to build it, or a warning */
  hint?: React.ReactNode;
}) {
  return (
    <div className={`${styles.siltHud} ${styles[`combo_${tone}`]}`}>
      <div
        className={`${styles.combo} ${styles[`combo_${tone}`]} ${live ? styles.comboLive : ""} ${peak ? styles.comboMax : ""}`}
      >
        <span className={styles.comboCount}>{label}</span>
        {pips ? (
          <span className={styles.comboPips} aria-hidden="true">
            {Array.from({ length: pips.of }, (_, i) => (
              <i key={i} data-lit={i < pips.lit || undefined} />
            ))}
          </span>
        ) : (
          <span className={styles.comboBar} aria-hidden="true">
            <i style={{ width: `${Math.max(0, Math.min(1, bar ?? 0)) * 100}%` }} />
          </span>
        )}
        <span className={styles.comboMult}>
          ×{mult.toFixed(mult % 1 === 0 || Math.round(mult * 10) === mult * 10 ? 1 : 2)}
          <small>{note}</small>
        </span>
      </div>
      {hint && <p className={styles.comboHint}>{hint}</p>}
    </div>
  );
}
