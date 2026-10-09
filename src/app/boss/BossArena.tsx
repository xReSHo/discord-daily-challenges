"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BossState, HitResponse } from "@/lib/boss/types";
import { eclipsePhaseAt } from "@/lib/boss/mechanics/eclipse";
import {
  BREATH,
  CORONA,
  MOMENTUM,
  betterBreath,
  breathFrom,
  coronaMult,
  momentumMult,
  momentumStep,
  momentumTier,
} from "@/lib/boss/mechanics/combo";
import { WeakpointArena } from "./WeakpointArena";
import { MiniArena } from "./mini/MiniArena";
import { BossPortrait, ComboBand, Outcome, Stage, fmtDuration } from "./shared";
import styles from "./boss.module.css";

// Kept deliberately low-chatter for a free serverless host: while you're
// clicking, the flush response IS the poll (it returns full state), so we
// don't GET /api/boss at all. We only poll when idle, to see the boss die.
const FLUSH_MS = 2500;
const POLL_IDLE_MS = 6000;
const IDLE_AFTER_MS = 3500; // no clicks for this long -> resume idle polling
const HURT_MS = 130;
const TICK_MS = 66; // ~15fps display refresh, decoupled from click rate
const COMBO_TICK_MS = 120; // how often the combo band is redrawn
const PACE_WINDOW_MS = 2500; // momentum reads the pace over this long

// escalation
const STREAK_GAP_MS = 2500; // over-cap events further apart than this reset the streak
const CAPTCHA_STREAK_HITS = 45; // this many over-cap clicks in one streak -> captcha
const CAPTCHA_BURST_WINDOW_MS = 1200;

type Captcha = { a: number; b: number };
function makeCaptcha(): Captcha {
  const r = () => 2 + Math.floor(Math.random() * 8);
  return { a: r(), b: r() };
}

/**
 * Routes to the right arena for the boss's mechanic. The dispatch is fixed at
 * mount (`initial` never changes — the page is force-dynamic and fetched once);
 * each arena reloads the page if a poll shows it's the wrong one now (e.g. an
 * upcoming→active transition, or the fight ending).
 */
export function BossArena({ initial }: { initial: BossState }) {
  if (initial.status === "active" && initial.mechanic === "weakpoint") {
    return <WeakpointArena initial={initial} />;
  }
  if (initial.status === "active" && initial.mechanic === "miniarena") {
    return <MiniArena initial={initial} />;
  }
  return <ClickerArena initial={initial} />;
}

function ClickerArena({ initial }: { initial: BossState }) {
  // slow, authoritative state — only changes on poll / flush response
  const [server, setServer] = useState<BossState>(initial);
  // fast display state — ticked from refs, never set per-click
  const [display, setDisplay] = useState({ hp: initial.hp, mine: initial.yourDamage });
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<{ msg: string; key: number } | null>(null);
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [captchaInput, setCaptchaInput] = useState("");
  const [captchaBad, setCaptchaBad] = useState(false);

  const pendingRef = useRef(0); // clicks not yet sent
  const unackedRef = useRef(0); // clicks in the in-flight request
  const lastClickRef = useRef(0); // performance.now() of the last accepted click
  const hitTimesRef = useRef<number[]>([]); // accepted clicks, rolling 1s
  const rawTimesRef = useRef<number[]>([]); // every click incl. rejected, for burst detection
  const overCapRef = useRef({ streakStart: 0, lastAt: 0, hits: 0 });
  const warnedRef = useRef(false);
  const portraitRef = useRef<HTMLButtonElement>(null);
  const hurtTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushingRef = useRef(false);
  const activeRef = useRef(false);
  const captchaRef = useRef(false);
  const multRef = useRef(1); // current eclipse damage multiplier, for the ticker

  // --- the combo, kept here between answers from the server. The server
  // decides the damage; this is only so the band moves the moment you act. ---
  const comboKind = server.combo?.kind;
  const paceRef = useRef<number[]>([]); // accepted clicks, rolling PACE_WINDOW_MS
  const furyRef = useRef(initial.combo?.kind === "momentum" ? initial.combo.value : 0);
  const breathRef = useRef(
    initial.combo?.kind === "breath"
      ? { blows: initial.combo.blows, mult: initial.combo.mult }
      : { blows: 0, mult: 1 },
  );
  const restRef = useRef(0); // longest pause before a strike, this batch
  const comboMultRef = useRef(1);
  const [band, setBand] = useState(() => ({
    fury: initial.combo?.kind === "momentum" ? initial.combo.value : 0,
    rest: 0,
    blows: initial.combo?.kind === "breath" ? initial.combo.blows : 0,
    mult: initial.combo?.kind === "breath" ? initial.combo.mult : 1,
    inflight: 0, // strikes not yet answered, for the corona count
  }));

  const active = server.status === "active" && !server.slain;

  // eclipse phase — derived locally from spawnsAt + the cycle config, so the
  // countdown ticks between polls with no extra request. The server still owns
  // the authoritative multiplier applied to each hit.
  const phase = useMemo(() => {
    if (!server.phase) return null;
    return eclipsePhaseAt(
      server.phase,
      server.spawnsAt,
      Date.parse(server.spawnsAt),
      now,
    );
  }, [server.phase, server.spawnsAt, now]);

  // mirror render values into refs for the long-lived intervals
  useEffect(() => {
    activeRef.current = active;
    captchaRef.current = captcha !== null;
    multRef.current = phase?.mult ?? 1;
    if (server.combo?.kind === "corona") comboMultRef.current = coronaMult(server.combo.stacks);
  });

  // --- idle poll (skipped entirely while you're actively fighting) ---
  useEffect(() => {
    let alive = true;
    async function poll() {
      // during a fight the hit response already carries full state
      if (
        pendingRef.current > 0 ||
        unackedRef.current > 0 ||
        performance.now() - lastClickRef.current < IDLE_AFTER_MS
      ) {
        return;
      }
      try {
        const res = await fetch("/api/boss", { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as BossState;
        if (!alive) return;
        // a mechanic that needs its own arena just went live — reload into it
        if (
          next.status === "active" &&
          (next.mechanic === "weakpoint" || next.mechanic === "miniarena")
        ) {
          window.location.reload();
          return;
        }
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
  }, [server.status]);

  // --- flush accumulated clicks ---
  useEffect(() => {
    const id = setInterval(async () => {
      if (flushingRef.current || captchaRef.current || !activeRef.current) return;
      const n = pendingRef.current;
      if (n <= 0) return;
      pendingRef.current = 0;
      unackedRef.current = n;
      flushingRef.current = true;
      try {
        const res = await fetch("/api/boss/hit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clicks: n, rest: Math.round(restRef.current) }),
        });
        restRef.current = 0;
        const data = (await res.json()) as HitResponse;
        // only one flush is ever in flight, so its state is authoritative
        if (data.state) {
          setServer(data.state);
          const c = data.state.combo;
          if (c?.kind === "momentum") furyRef.current = c.value;
          // heavy blows are spent as you strike; only take the server's count
          // when nothing has been struck since
          if (c?.kind === "breath" && pendingRef.current === 0) {
            breathRef.current = { blows: c.blows, mult: c.mult };
          }
        }
      } catch {
        /* dropped batch — poll will re-sync */
      } finally {
        unackedRef.current = 0;
        flushingRef.current = false;
      }
    }, FLUSH_MS);
    return () => clearInterval(id);
  }, []);

  // --- display ticker: reconciles server hp/damage with in-flight local
  // clicks at ~15fps, so the render rate never tracks the click rate ---
  useEffect(() => {
    const id = setInterval(() => {
      const inflight = pendingRef.current + unackedRef.current;
      const dmg = inflight * server.dmgPerClick * multRef.current * comboMultRef.current;
      const hpR = Math.ceil(Math.max(0, server.hp - dmg));
      const mineR = Math.round((server.yourDamage + dmg) * 10) / 10;
      setDisplay((d) =>
        d.hp === hpR && d.mine === mineR ? d : { hp: hpR, mine: mineR },
      );
    }, TICK_MS);
    return () => clearInterval(id);
  }, [server.hp, server.yourDamage, server.dmgPerClick]);

  // --- the combo band: momentum settles toward your pace, breath fills while
  // you hold still. Drawn a few times a second, never per click. ---
  useEffect(() => {
    if (comboKind !== "momentum" && comboKind !== "breath" && comboKind !== "corona") return;
    const id = setInterval(() => {
      const t = performance.now();
      if (comboKind === "momentum") {
        const pace = paceRef.current;
        while (pace.length && t - pace[0] > PACE_WINDOW_MS) pace.shift();
        furyRef.current = activeRef.current
          ? momentumStep(
              furyRef.current,
              pace.length / (PACE_WINDOW_MS / 1000),
              server.cpsCap,
              COMBO_TICK_MS / 1000,
            )
          : furyRef.current;
        comboMultRef.current = momentumMult(furyRef.current);
      } else if (comboKind === "breath") {
        comboMultRef.current = breathRef.current.blows > 0 ? breathRef.current.mult : 1;
      }
      const fury = Math.round(furyRef.current * 200) / 200;
      const rest = lastClickRef.current ? Math.min(BREATH.fullMs, t - lastClickRef.current) : 0;
      const restShown = Math.round(rest / 100) * 100;
      const { blows, mult } = breathRef.current;
      const inflight = pendingRef.current + unackedRef.current;
      setBand((b) =>
        b.fury === fury &&
        b.rest === restShown &&
        b.blows === blows &&
        b.mult === mult &&
        b.inflight === inflight
          ? b
          : { fury, rest: restShown, blows, mult, inflight },
      );
    }, COMBO_TICK_MS);
    return () => clearInterval(id);
  }, [comboKind, server.cpsCap]);

  // --- 1s clock ---
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // --- one-shot toast auto-hide ---
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const flashHurt = useCallback(() => {
    const el = portraitRef.current;
    if (!el) return;
    el.classList.add(styles.hurt);
    if (hurtTimerRef.current) clearTimeout(hurtTimerRef.current);
    hurtTimerRef.current = setTimeout(
      () => el.classList.remove(styles.hurt),
      HURT_MS,
    );
  }, []);

  const registerOverCap = useCallback(() => {
    const t = performance.now();

    if (!warnedRef.current) {
      warnedRef.current = true;
      setToast({
        msg: `Ease up — ${server.cpsCap} clicks a second is the cap. Extra clicks don't land.`,
        key: t,
      });
    }

    const o = overCapRef.current;
    if (t - o.lastAt > STREAK_GAP_MS) {
      o.streakStart = t;
      o.hits = 0;
    }
    o.hits += 1;
    o.lastAt = t;

    const raw = rawTimesRef.current;
    const burst = raw.filter((x) => t - x <= CAPTCHA_BURST_WINDOW_MS).length;

    if (o.hits >= CAPTCHA_STREAK_HITS || burst >= server.cpsCap * 4) {
      pendingRef.current = 0; // don't submit the abusive backlog
      setCaptcha(makeCaptcha());
      setCaptchaInput("");
      setCaptchaBad(false);
    }
  }, [server.cpsCap]);

  const onHit = useCallback(() => {
    if (!activeRef.current || captchaRef.current) return;
    const t = performance.now();

    const raw = rawTimesRef.current;
    raw.push(t);
    while (raw.length && t - raw[0] > 2000) raw.shift();

    const hits = hitTimesRef.current;
    hits.push(t);
    while (hits.length && t - hits[0] > 1000) hits.shift();

    if (hits.length > server.cpsCap) {
      hits.pop();
      registerOverCap();
      return;
    }

    if (comboKind === "momentum") {
      paceRef.current.push(t);
    } else if (comboKind === "breath") {
      // the pause before this strike is the breath drawn; then spend a blow
      const rest = lastClickRef.current ? t - lastClickRef.current : 0;
      const drawn = breathFrom(rest);
      if (drawn) {
        restRef.current = Math.max(restRef.current, rest);
        breathRef.current = betterBreath(breathRef.current, drawn);
      }
      const held = breathRef.current;
      if (held.blows > 0) {
        breathRef.current =
          held.blows > 1 ? { blows: held.blows - 1, mult: held.mult } : { blows: 0, mult: 1 };
      }
    }

    pendingRef.current += 1;
    lastClickRef.current = t;
    flashHurt();
  }, [server.cpsCap, comboKind, flashHurt, registerOverCap]);

  function solveCaptcha() {
    if (!captcha) return;
    if (parseInt(captchaInput, 10) === captcha.a + captcha.b) {
      setCaptcha(null);
      setCaptchaInput("");
      setCaptchaBad(false);
      overCapRef.current = { streakStart: 0, lastAt: 0, hits: 0 };
      hitTimesRef.current = [];
      rawTimesRef.current = [];
    } else {
      setCaptchaBad(true);
      setCaptcha(makeCaptcha());
      setCaptchaInput("");
    }
  }

  const spawnsIn = new Date(server.spawnsAt).getTime() - now;
  const expiresIn = new Date(server.expiresAt).getTime() - now;
  const nextIn = new Date(server.nextSpawnsAt).getTime() - now;

  // ---------- upcoming ----------
  if (server.status === "upcoming") {
    return (
      <Stage
        state={server}
        eyebrow="The Weekly Raid"
        clock={{ label: "Wakes in", ms: spawnsIn }}
        notice={
          <p className={styles.sub}>
            {server.blurb ? `${server.blurb} ` : null}
            {server.mechanic === "clicker"
              ? `${server.dmgPerClick} damage a click, ${server.cpsCap} clicks a second. `
              : null}
            {server.maxHp.toLocaleString("en-US")} health to break.
          </p>
        }
      >
        <BossPortrait image={server.image} name={server.name} dimmed />
      </Stage>
    );
  }

  // ---------- ended ----------
  if (server.status === "ended") {
    return (
      <Stage
        state={server}
        eyebrow="The Weekly Raid"
        hp={server.hp}
        mine={server.yourDamage}
        clock={{ label: "Next raid in", ms: nextIn }}
        notice={
          <>
            <p className={`${styles.lead} ${server.slain ? styles.won : styles.lost}`}>
              {server.slain ? `${server.name} has fallen.` : `${server.name} escaped into the mist.`}
            </p>
            <Outcome state={server} />
          </>
        }
      >
        <BossPortrait image={server.image} name={server.name} fallen={server.slain} dimmed />
      </Stage>
    );
  }

  // ---------- active ----------
  let comboBand: React.ReactNode = null;
  const combo = server.combo;
  if (combo?.kind === "momentum") {
    const tier = momentumTier(band.fury);
    comboBand = (
      <ComboBand
        tone="fury"
        label={<b>{MOMENTUM.tiers[tier]}</b>}
        bar={band.fury}
        mult={momentumMult(band.fury)}
        live={band.fury > 0.02}
        peak={tier === 3}
        hint={
          tier === 3 ? (
            <>
              <b>Onslaught.</b> Hold this pace and every blow lands at its hardest.
            </>
          ) : (
            <>
              Strike fast without stopping to build his wrath. It fades as you slow.
            </>
          )
        }
      />
    );
  } else if (combo?.kind === "breath") {
    const drawing = band.blows === 0 && band.rest >= 400;
    const drawn = breathFrom(band.rest);
    comboBand = (
      <ComboBand
        tone="breath"
        label={
          band.blows > 0 ? (
            <>
              <b>{band.blows}</b> heavy blow{band.blows === 1 ? "" : "s"}
            </>
          ) : (
            <b>{drawing ? "Drawing breath" : "Breath"}</b>
          )
        }
        bar={band.blows > 0 ? band.blows / BREATH.blows : drawing ? band.rest / BREATH.fullMs : 0}
        mult={band.blows > 0 ? band.mult : drawing && drawn ? drawn.mult : 1}
        note={band.blows > 0 ? "each" : drawing && drawn ? "if you strike now" : "damage"}
        live={band.blows > 0 || drawing}
        peak={band.blows === 0 && band.rest >= BREATH.fullMs}
        hint={
          band.blows > 0 ? (
            <>Strike — these blows land heavy. Then stop and breathe again.</>
          ) : band.rest >= BREATH.fullMs ? (
            <>
              <b>A full breath.</b> Strike now: your next {BREATH.blows} blows land at ×
              {(1 + BREATH.maxBonus).toFixed(1)}.
            </>
          ) : (
            <>
              Stop striking to draw breath, up to {BREATH.fullMs / 1000} seconds. The longer you
              hold, the heavier your next blows.
            </>
          )
        }
      />
    );
  } else if (combo?.kind === "corona" && phase) {
    const inflight = phase.kind === "dark" ? band.inflight : 0;
    const earned = combo.phase === phase.index && combo.strikes >= CORONA.strikes;
    const strikes =
      phase.kind !== "dark"
        ? 0
        : Math.min(CORONA.strikes, (combo.phase === phase.index ? combo.strikes : 0) + inflight);
    comboBand = (
      <ComboBand
        tone="corona"
        label={
          <>
            <b>{combo.stacks}</b> corona{combo.stacks === 1 ? "" : "s"}
          </>
        }
        pips={{ lit: combo.stacks, of: CORONA.max }}
        mult={coronaMult(combo.stacks)}
        live={combo.stacks > 0}
        peak={combo.stacks >= CORONA.max}
        hint={
          phase.kind === "light" ? (
            <span className={combo.stacks > 0 ? styles.comboHintWarn : undefined}>
              {combo.stacks > 0
                ? "Hold. One strike in the light burns every corona you hold."
                : "Hold. Nothing is earned in the light."}
            </span>
          ) : phase.kind === "dark" ? (
            earned || combo.stacks >= CORONA.max ? (
              <>This eclipse&apos;s corona is yours. Keep striking while it is dark.</>
            ) : (
              <>
                <b>
                  {strikes} / {CORONA.strikes}
                </b>{" "}
                strikes this eclipse to earn a corona.
              </>
            )
          ) : (
            <>Land {CORONA.strikes} strikes in each black sun to earn a corona. Never strike in the light.</>
          )
        }
      />
    );
  }

  return (
    <Stage
      state={server}
      eyebrow={server.adminOnly ? "Test Raid — admins only" : "The Weekly Raid — fight now"}
      hp={display.hp}
      mine={display.mine}
      clock={{ label: "Ends in", ms: expiresIn }}
      notice={
        <>
          {phase ? (
            <div
              className={`${styles.eclipse} ${
                phase.kind === "dark"
                  ? styles.eclipseDark
                  : phase.kind === "light"
                    ? styles.eclipseLight
                    : styles.eclipseNeutral
              }`}
            >
              <span className={styles.sun} aria-hidden="true" />
              <span className={styles.eclipseState}>
                {phase.kind === "dark"
                  ? "The black sun is open"
                  : phase.kind === "light"
                    ? "The light drowns your blows"
                    : "The dusk holds — clean strikes"}
              </span>
              <span className={styles.eclipseMult}>
                <small>hits</small> ×{phase.mult}
              </span>
              <span className={`mono ${styles.eclipseClock}`}>
                {fmtDuration(phase.endsInMs)} →{" "}
                {phase.nextKind === "dark" ? "black sun" : phase.nextKind === "light" ? "the light" : "the dusk"}
              </span>
            </div>
          ) : (
            <p className={styles.sub}>
              Strike him — {server.dmgPerClick} damage a blow, {server.cpsCap} blows a second at most.
            </p>
          )}
          {comboBand}
          {toast && (
            <p key={toast.key} className={styles.toast}>
              {toast.msg}
            </p>
          )}
        </>
      }
    >
      <div className={`${styles.portraitWrap} ${phase?.kind === "dark" ? styles.portraitLit : ""}`}>
        <BossPortrait ref={portraitRef} image={server.image} name={server.name} onHit={onHit} />
        {captcha && (
          <div className={styles.captcha} role="dialog" aria-label="Quick check">
            <p className={styles.captchaTitle}>Quick check</p>
            <p className={styles.captchaQ}>
              What is <b>{captcha.a}</b> + <b>{captcha.b}</b>?
            </p>
            <div className={styles.captchaRow}>
              <input
                className={styles.captchaInput}
                inputMode="numeric"
                value={captchaInput}
                autoFocus
                onChange={(e) => setCaptchaInput(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                onKeyDown={(e) => e.key === "Enter" && solveCaptcha()}
              />
              <button type="button" className={styles.captchaBtn} onClick={solveCaptcha}>
                Continue
              </button>
            </div>
            {captchaBad && <p className={styles.captchaErr}>Not quite — try this one.</p>}
          </div>
        )}
      </div>
    </Stage>
  );
}
