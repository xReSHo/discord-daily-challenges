"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Coins, Users, Swords, Timer } from "lucide-react";
import type { BossState, HitResponse } from "@/lib/boss/types";
import styles from "./boss.module.css";

const POLL_ACTIVE_MS = 2000;
const POLL_IDLE_MS = 15000;
const FLUSH_MS = 1000;
const HURT_MS = 130;

function fmtDuration(ms: number): string {
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

export function BossArena({ initial }: { initial: BossState }) {
  const [state, setState] = useState<BossState>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [hurt, setHurt] = useState(false);
  const [tooFast, setTooFast] = useState(false);

  const pendingRef = useRef(0);
  const clickTimesRef = useRef<number[]>([]);
  const hurtTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushingRef = useRef(false);

  const active = state.status === "active" && !state.slain;

  // --- poll shared state ---
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/boss", { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as BossState;
        if (alive) {
          setState((prev) => ({
            ...next,
            // don't let a slightly-stale poll bounce the bar backwards past
            // damage we've already applied locally this second
            hp: Math.min(prev.hp, next.hp),
            dealt: Math.max(prev.dealt, next.dealt),
          }));
        }
      } catch {
        /* transient — next tick */
      }
    }
    poll();
    const id = setInterval(
      poll,
      state.status === "active" ? POLL_ACTIVE_MS : POLL_IDLE_MS,
    );
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [state.status]);

  // --- flush accumulated clicks ---
  useEffect(() => {
    const id = setInterval(async () => {
      if (flushingRef.current) return;
      const n = pendingRef.current;
      if (n <= 0 || !active) return;
      pendingRef.current = 0;
      flushingRef.current = true;
      try {
        const res = await fetch("/api/boss/hit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clicks: n }),
        });
        const data = (await res.json()) as HitResponse;
        if (data.ok && typeof data.hp === "number") {
          setState((prev) => ({
            ...prev,
            hp: data.hp!,
            dealt: data.dealt ?? prev.dealt,
            slain: data.slain ?? prev.slain,
            yourDamage: data.yourDamage ?? prev.yourDamage,
          }));
        } else if (data.state) {
          setState(data.state);
        }
      } catch {
        /* dropped batch — no retry, keep clicking */
      } finally {
        flushingRef.current = false;
      }
    }, FLUSH_MS);
    return () => clearInterval(id);
  }, [active]);

  // --- 1s clock for countdowns ---
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const onHit = useCallback(() => {
    if (!active) return;
    const t = performance.now();
    const times = clickTimesRef.current;
    times.push(t);
    while (times.length && t - times[0] > 1000) times.shift();
    if (times.length > state.cpsCap) {
      times.pop();
      setTooFast(true);
      setTimeout(() => setTooFast(false), 400);
      return;
    }
    pendingRef.current += 1;

    setState((prev) => ({
      ...prev,
      hp: Math.max(0, prev.hp - prev.dmgPerClick),
      yourDamage: Math.round((prev.yourDamage + prev.dmgPerClick) * 10) / 10,
    }));

    setHurt(true);
    if (hurtTimer.current) clearTimeout(hurtTimer.current);
    hurtTimer.current = setTimeout(() => setHurt(false), HURT_MS);
  }, [active, state.cpsCap]);

  const hpPct = Math.max(0, Math.min(100, (state.hp / state.maxHp) * 100));
  const spawnsIn = new Date(state.spawnsAt).getTime() - now;
  const expiresIn = new Date(state.expiresAt).getTime() - now;
  const nextIn = new Date(state.nextSpawnsAt).getTime() - now;

  // ---------- upcoming ----------
  if (state.status === "upcoming") {
    return (
      <div className={styles.card}>
        <p className="eyebrow">The Weekly Raid</p>
        <h1 className={styles.name}>{state.name}</h1>
        <BossPortrait hurt={false} onHit={undefined} dimmed />
        <p className={styles.lead}>
          The Hollow Sovereign returns in{" "}
          <span className={styles.count}>{fmtDuration(spawnsIn)}</span>.
        </p>
        <p className={styles.sub}>
          When he rises, strike him by clicking — {state.dmgPerClick} damage a
          click, {state.cpsCap} clicks a second, {state.maxHp.toLocaleString()}{" "}
          health. Fell him and split {state.rewardPool.toLocaleString()} coins by
          the damage you dealt. Fight and fail and you lose{" "}
          {state.penaltyEach.toLocaleString()}.
        </p>
      </div>
    );
  }

  // ---------- ended ----------
  if (state.status === "ended") {
    return (
      <div className={styles.card}>
        <p className="eyebrow">The Weekly Raid</p>
        <h1 className={styles.name}>{state.name}</h1>
        <BossPortrait hurt={false} onHit={undefined} fallen={state.slain} dimmed />
        {state.slain ? (
          <p className={`${styles.lead} ${styles.won}`}>Veyrath has fallen.</p>
        ) : (
          <p className={`${styles.lead} ${styles.lost}`}>
            Veyrath escaped into the mist.
          </p>
        )}
        <Outcome state={state} />
        <p className={styles.sub}>
          Next raid in <span className={styles.count}>{fmtDuration(nextIn)}</span>.
        </p>
        <Leaderboard state={state} />
      </div>
    );
  }

  // ---------- active ----------
  return (
    <div className={styles.card}>
      <p className="eyebrow">The Weekly Raid — fight now</p>
      <h1 className={styles.name}>{state.name}</h1>

      <div className={styles.hpWrap}>
        <div className={styles.hpBar}>
          <div
            className={styles.hpFill}
            style={{ width: `${hpPct}%` }}
            data-low={hpPct < 25 || undefined}
          />
        </div>
        <div className={styles.hpText}>
          <span className="mono">
            {Math.ceil(state.hp).toLocaleString()} /{" "}
            {state.maxHp.toLocaleString()}
          </span>
          <span className="mono">{Math.round(hpPct)}%</span>
        </div>
      </div>

      <BossPortrait hurt={hurt} onHit={onHit} />
      {tooFast && <p className={styles.tooFast}>Too fast — {state.cpsCap}/sec max</p>}

      <div className={styles.stats}>
        <span className="rune">
          <Swords size={14} /> {state.yourDamage.toLocaleString()}
        </span>
        <span className="rune">
          <Users size={14} /> {state.participants}
        </span>
        <span className="rune">
          <Timer size={14} /> {fmtDuration(expiresIn)}
        </span>
      </div>

      <p className={styles.sub}>
        Bounty pool {state.rewardPool.toLocaleString()} coins, split by damage.
        Everyone who fights and loses forfeits {state.penaltyEach.toLocaleString()}.
      </p>

      <Leaderboard state={state} />
    </div>
  );
}

function BossPortrait({
  hurt,
  onHit,
  dimmed,
  fallen,
}: {
  hurt: boolean;
  onHit?: () => void;
  dimmed?: boolean;
  fallen?: boolean;
}) {
  const cls = [
    styles.portrait,
    hurt ? styles.hurt : "",
    dimmed ? styles.dimmed : "",
    fallen ? styles.fallen : "",
    onHit ? styles.hittable : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <picture>
      <source srcSet="/boss/veyrath-idle.webp" type="image/webp" />
      <img
        src="/boss/veyrath-idle.png"
        alt="Veyrath, The Hollow Sovereign"
        draggable={false}
      />
    </picture>
  );

  if (!onHit) return <div className={cls}>{content}</div>;
  return (
    <button
      type="button"
      className={cls}
      onPointerDown={(e) => {
        e.preventDefault();
        onHit();
      }}
      aria-label="Strike Veyrath"
    >
      {content}
      <span className={styles.hitRing} aria-hidden />
    </button>
  );
}

function Outcome({ state }: { state: BossState }) {
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
      {state.yourPayout.toLocaleString()} coins — you fought and Veyrath lived.
    </p>
  );
}

function Leaderboard({ state }: { state: BossState }) {
  if (state.top.length === 0) return null;
  return (
    <ol className={styles.board}>
      {state.top.map((l) => (
        <li key={l.rank} className={l.you ? styles.youRow : undefined}>
          <span className={styles.rank}>{l.rank}</span>
          <span className={styles.who}>{l.name}</span>
          <span className={`mono ${styles.dmg}`}>
            {l.damage.toLocaleString()}
          </span>
        </li>
      ))}
    </ol>
  );
}
