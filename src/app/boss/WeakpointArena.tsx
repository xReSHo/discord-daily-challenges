"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Users, Swords, Timer } from "lucide-react";
import type { BossState, HitResponse } from "@/lib/boss/types";
import { liveSacs, weakpointConfig, type Sac } from "@/lib/boss/mechanics/weakpoint";
import { AdminBar, BossPortrait, Leaderboard, fmtDuration } from "./shared";
import styles from "./boss.module.css";

const FLUSH_MS = 1000;
const POLL_IDLE_MS = 6000;
const FRAME_MS = 60; // sac layer refresh

/** Slot k of `slots`, on an ellipse around the portrait centre. */
function slotStyle(slot: number, slots: number): { left: string; top: string } {
  const ang = (-90 + (slot * 360) / slots) * (Math.PI / 180);
  return {
    left: `${50 + Math.cos(ang) * 38}%`,
    top: `${50 + Math.sin(ang) * 40}%`,
  };
}

type View = { nowMs: number; sacs: Sac[]; cooling: boolean };

export function WeakpointArena({ initial }: { initial: BossState }) {
  const [server, setServer] = useState(initial);
  const [view, setView] = useState<View>(() => ({
    nowMs: Date.parse(initial.spawnsAt),
    sacs: [],
    cooling: false,
  }));

  const serverRef = useRef(server);
  const sacHitsRef = useRef(0);
  const missRef = useRef(0);
  const poppedRef = useRef<Set<number>>(new Set());
  const flushingRef = useRef(false);
  const lastActionRef = useRef(0);

  useEffect(() => {
    serverRef.current = server;
  });

  const recompute = useCallback(() => {
    const s = serverRef.current;
    const nowMs = Date.now();
    const cooling = (s.yourCooldownUntil ?? 0) > nowMs;
    const cfg = s.weakpoint ? weakpointConfig(s.weakpoint) : null;
    const sacs =
      cfg && !cooling
        ? liveSacs(
            cfg,
            s.bossKey,
            nowMs - Date.parse(s.spawnsAt),
          ).filter((x) => !poppedRef.current.has(x.i))
        : [];
    setView({ nowMs, sacs, cooling });
  }, []);

  // wrong arena / fight over — bounce to the dispatcher
  useEffect(() => {
    if (!server.weakpoint || server.status !== "active" || server.slain) {
      window.location.reload();
    }
  }, [server.weakpoint, server.status, server.slain]);

  // sac animation
  useEffect(() => {
    recompute();
    const id = setInterval(recompute, FRAME_MS);
    return () => clearInterval(id);
  }, [recompute]);

  // flush popped / missed counts every second
  useEffect(() => {
    const id = setInterval(async () => {
      if (flushingRef.current) return;
      const h = sacHitsRef.current;
      const m = missRef.current;
      if (h === 0 && m === 0) return;
      sacHitsRef.current = 0;
      missRef.current = 0;
      flushingRef.current = true;
      try {
        const res = await fetch("/api/boss/hit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sacHits: h, misses: m }),
        });
        const data = (await res.json()) as HitResponse;
        if (data.state) setServer(data.state);
      } catch {
        /* dropped batch — the idle poll re-syncs */
      } finally {
        flushingRef.current = false;
      }
    }, FLUSH_MS);
    return () => clearInterval(id);
  }, []);

  // idle poll — only when the fighter isn't actively lancing
  useEffect(() => {
    let alive = true;
    async function poll() {
      if (flushingRef.current) return;
      if (performance.now() - lastActionRef.current < 2500) return;
      try {
        const res = await fetch("/api/boss", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const next = (await res.json()) as BossState;
        setServer((prev) => ({
          ...next,
          hp: Math.min(prev.hp, next.hp),
          dealt: Math.max(prev.dealt, next.dealt),
        }));
      } catch {
        /* transient */
      }
    }
    poll();
    const id = setInterval(poll, POLL_IDLE_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const popSac = useCallback(
    (i: number) => {
      if (poppedRef.current.has(i)) return;
      poppedRef.current.add(i);
      if (poppedRef.current.size > 200) {
        const cutoff = i - 60;
        for (const x of poppedRef.current) {
          if (x < cutoff) poppedRef.current.delete(x);
        }
      }
      sacHitsRef.current += 1;
      lastActionRef.current = performance.now();
      recompute();
    },
    [recompute],
  );

  const registerMiss = useCallback(() => {
    missRef.current += 1;
    lastActionRef.current = performance.now();
  }, []);

  if (!server.weakpoint) return null; // the guard effect reloads us out

  const cfg = weakpointConfig(server.weakpoint);
  const { nowMs, sacs, cooling } = view;
  const spawnMs = Date.parse(server.spawnsAt);
  const coolingUntil = server.yourCooldownUntil ?? 0;
  const hpPct = Math.max(0, Math.min(100, (server.hp / server.maxHp) * 100));
  const expiresIn = Date.parse(server.expiresAt) - nowMs;

  return (
    <div className={styles.card}>
      <p className="eyebrow">
        {server.adminOnly
          ? "Test Raid — admins only"
          : "The Weekly Raid — fight now"}
      </p>
      <h1 className={styles.name}>{server.name}</h1>
      {(server.adminOnly || !server.paysOut) && (
        <p className={styles.testFlag}>
          {server.adminOnly && "Only admins can see this fight. "}
          {!server.paysOut && "No coins are paid out for it."}
        </p>
      )}
      <AdminBar show={server.viewerIsAdmin} active />

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
            {Math.ceil(server.hp).toLocaleString()} /{" "}
            {server.maxHp.toLocaleString()}
          </span>
          <span className="mono">{Math.round(hpPct)}%</span>
        </div>
      </div>

      <p className={styles.sub}>
        {cooling
          ? "The rot has your arm — wait for it to pass."
          : "Lance the silt-sacs the moment they surface. Wild swings only feed the rot."}
      </p>

      <div
        className={`${styles.portraitWrap} ${
          cooling ? styles.portraitStalled : ""
        }`}
      >
        <BossPortrait image={server.image} name={server.name} dimmed />
        <div
          className={styles.sacZone}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget && !cooling) registerMiss();
          }}
        >
          {sacs.map((s) => {
            const t = (nowMs - spawnMs - s.bornMs) / (s.diesMs - s.bornMs);
            const opacity =
              t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1;
            return (
              <button
                key={s.i}
                type="button"
                className={styles.sac}
                style={{ ...slotStyle(s.slot, cfg.slots), opacity }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  popSac(s.i);
                }}
                aria-label="Lance the sac"
              />
            );
          })}
          {cooling && (
            <div className={styles.stall}>
              rot spreading — {Math.max(0, Math.ceil((coolingUntil - nowMs) / 1000))}s
            </div>
          )}
        </div>
      </div>

      <div className={styles.stats}>
        <span className="rune">
          <Swords size={14} /> {Math.round(server.yourDamage).toLocaleString()}
        </span>
        <span className="rune">
          <Users size={14} /> {server.participants}
        </span>
        <span className="rune">
          <Timer size={14} /> {fmtDuration(expiresIn)}
        </span>
      </div>

      <p className={styles.sub}>
        Bounty pool {server.rewardPool.toLocaleString()} coins, split by damage.
        Everyone who fights and loses forfeits{" "}
        {server.penaltyEach.toLocaleString()}.
      </p>

      <Leaderboard top={server.top} />
    </div>
  );
}
