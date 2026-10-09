"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BossState, HitResponse } from "@/lib/boss/types";
import {
  COMBO_IDLE_MS,
  MAX_SEQ,
  SAC_KINDS,
  comboMult,
  liveSacs,
  weakpointConfig,
  type Sac,
} from "@/lib/boss/mechanics/weakpoint";
import { BossPortrait, Stage } from "./shared";
import styles from "./boss.module.css";

const FLUSH_MS = 1000;
const POLL_IDLE_MS = 6000;
const FRAME_MS = 60; // sac layer refresh
const FX_MS = 800; // how long a burst and its number stay on screen
const MAX_FX = 10;

/** The look of each kind, in the order of SAC_KINDS. */
const SKIN = [styles.sacK0, styles.sacK1, styles.sacK2, styles.sacK3];

/** Slot k of `slots`, on an ellipse around the portrait centre. */
function slotAt(slot: number, slots: number): { x: number; y: number } {
  const ang = (-90 + (slot * 360) / slots) * (Math.PI / 180);
  return { x: 50 + Math.cos(ang) * 38, y: 50 + Math.sin(ang) * 40 };
}

/** "2", "4.4", "0.2" — a damage figure without trailing noise. */
function fmtDmg(n: number): string {
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

type View = { nowMs: number; sacs: Sac[]; cooling: boolean; combo: number };

/** One burst on screen: where, what was struck (-1 = nothing), what it dealt. */
type Fx = { id: number; x: number; y: number; kind: number; text: string; until: number };

export function WeakpointArena({ initial }: { initial: BossState }) {
  const [server, setServer] = useState(initial);
  const [view, setView] = useState<View>(() => ({
    nowMs: Date.parse(initial.spawnsAt),
    sacs: [],
    cooling: false,
    combo: 0,
  }));
  const [fx, setFx] = useState<Fx[]>([]);

  const serverRef = useRef(server);
  /** What the fighter did since the last flush, in order (see `cleanSeq`). */
  const seqRef = useRef("");
  const comboRef = useRef(0);
  const lastLanceRef = useRef(0);
  const fxIdRef = useRef(0);
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
    // a combo is kept by lancing: it lapses with the arm stalled or idle
    if (cooling || performance.now() - lastLanceRef.current > COMBO_IDLE_MS) {
      comboRef.current = 0;
    }
    setView({ nowMs, sacs, cooling, combo: comboRef.current });
    setFx((prev) => (prev.some((f) => f.until <= nowMs) ? prev.filter((f) => f.until > nowMs) : prev));
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

  // flush what was done every second
  useEffect(() => {
    const id = setInterval(async () => {
      if (flushingRef.current) return;
      const seq = seqRef.current;
      if (!seq) return;
      seqRef.current = "";
      flushingRef.current = true;
      try {
        const res = await fetch("/api/boss/hit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seq }),
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

  const burst = useCallback((x: number, y: number, kind: number, text: string) => {
    const id = (fxIdRef.current += 1);
    const until = Date.now() + FX_MS;
    setFx((prev) => [...prev.slice(-(MAX_FX - 1)), { id, x, y, kind, text, until }]);
  }, []);

  const popSac = useCallback(
    (sac: Sac) => {
      if (poppedRef.current.has(sac.i)) return;
      const cfg = serverRef.current.weakpoint
        ? weakpointConfig(serverRef.current.weakpoint)
        : null;
      if (!cfg || seqRef.current.length >= MAX_SEQ) return;
      poppedRef.current.add(sac.i);
      if (poppedRef.current.size > 200) {
        const cutoff = sac.i - 60;
        for (const x of poppedRef.current) {
          if (x < cutoff) poppedRef.current.delete(x);
        }
      }
      const kind = SAC_KINDS[sac.kind];
      const dmg = cfg.dmgPerSac * kind.mult * comboMult(cfg, comboRef.current);
      comboRef.current += 1;
      seqRef.current += String(sac.kind);
      lastLanceRef.current = lastActionRef.current = performance.now();
      const at = slotAt(sac.slot, cfg.slots);
      burst(at.x, at.y, sac.kind, `+${fmtDmg(dmg)}`);
      recompute();
    },
    [burst, recompute],
  );

  const registerMiss = useCallback(
    (x: number, y: number) => {
      const cfg = serverRef.current.weakpoint
        ? weakpointConfig(serverRef.current.weakpoint)
        : null;
      if (!cfg || seqRef.current.length >= MAX_SEQ) return;
      seqRef.current += "m";
      comboRef.current = 0;
      lastActionRef.current = performance.now();
      burst(x, y, -1, cfg.missDmg > 0 ? `+${fmtDmg(cfg.missDmg)}` : "miss");
      recompute();
    },
    [burst, recompute],
  );

  if (!server.weakpoint) return null; // the guard effect reloads us out

  const cfg = weakpointConfig(server.weakpoint);
  const { nowMs, sacs, cooling, combo } = view;
  const spawnMs = Date.parse(server.spawnsAt);
  const coolingUntil = server.yourCooldownUntil ?? 0;
  const expiresIn = Date.parse(server.expiresAt) - nowMs;

  const mult = comboMult(cfg, combo);
  const capped = mult >= cfg.comboMax;
  const intoStep = combo % cfg.comboStep;
  const comboOn = cfg.comboMax > 1 && cfg.comboBonus > 0;

  return (
    <Stage
      state={server}
      eyebrow={server.adminOnly ? "Test Raid — admins only" : "The Weekly Raid — fight now"}
      hp={server.hp}
      mine={server.yourDamage}
      clock={{ label: "Ends in", ms: expiresIn }}
      notice={
        <div className={styles.siltHud}>
          {cooling ? (
            <p className={`${styles.sub} ${styles.lost}`}>
              The rot has your arm — wait for it to pass.
            </p>
          ) : (
            comboOn && (
              <div
                className={`${styles.combo} ${combo > 0 ? styles.comboLive : ""} ${capped ? styles.comboMax : ""}`}
                aria-live="off"
              >
                <span className={styles.comboCount}>
                  <b>{combo}</b> in a row
                </span>
                <span className={styles.comboBar} aria-hidden="true">
                  <i style={{ width: `${capped ? 100 : (intoStep / cfg.comboStep) * 100}%` }} />
                </span>
                <span className={styles.comboMult}>
                  ×{mult.toFixed(1)}
                  <small>{capped ? "at its peak" : "damage"}</small>
                </span>
              </div>
            )
          )}

          <ul className={styles.siltKey} aria-label="What each growth is worth">
            {SAC_KINDS.map((k, i) => (
              <li key={k.id}>
                <i className={`${styles.sacSkin} ${SKIN[i]}`} aria-hidden="true" />
                {k.name}
                <b>×{k.mult}</b>
              </li>
            ))}
            <li className={styles.siltKeyMiss}>
              A miss grazes for {fmtDmg(cfg.missDmg)}
              {comboOn ? " and ends the streak" : ""}
            </li>
          </ul>
        </div>
      }
    >
      <div className={`${styles.portraitWrap} ${cooling ? styles.portraitStalled : ""}`}>
        <BossPortrait image={server.image} name={server.name} dimmed />
        <div
          className={styles.sacZone}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget || cooling) return;
            const r = e.currentTarget.getBoundingClientRect();
            registerMiss(
              ((e.clientX - r.left) / r.width) * 100,
              ((e.clientY - r.top) / r.height) * 100,
            );
          }}
        >
          {sacs.map((s) => {
            const t = (nowMs - spawnMs - s.bornMs) / (s.diesMs - s.bornMs);
            const opacity = t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1;
            const kind = SAC_KINDS[s.kind];
            const at = slotAt(s.slot, cfg.slots);
            return (
              <button
                key={s.i}
                type="button"
                className={styles.sac}
                style={{ left: `${at.x}%`, top: `${at.y}%`, width: `${kind.size}%`, opacity }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  popSac(s);
                }}
                aria-label={`Lance the ${kind.name.toLowerCase()}`}
              >
                <i className={`${styles.sacSkin} ${SKIN[s.kind]}`} />
                {kind.mult > 1 && <span className={styles.sacTag}>×{kind.mult}</span>}
              </button>
            );
          })}

          {fx.map((f) => (
            <span
              key={f.id}
              className={`${styles.pop} ${f.kind < 0 ? styles.popMiss : ""}`}
              data-k={f.kind}
              style={{ left: `${f.x}%`, top: `${f.y}%` }}
              aria-hidden="true"
            >
              <i />
              <b>{f.text}</b>
            </span>
          ))}

          {cooling && (
            <div className={styles.stall}>
              rot spreading — {Math.max(0, Math.ceil((coolingUntil - nowMs) / 1000))}s
            </div>
          )}
        </div>
      </div>
    </Stage>
  );
}
