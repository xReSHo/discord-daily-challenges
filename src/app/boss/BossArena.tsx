"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Users, Swords, Timer } from "lucide-react";
import type { BossState, HitResponse } from "@/lib/boss/types";
import { eclipsePhaseAt } from "@/lib/boss/mechanics/eclipse";
import { WeakpointArena } from "./WeakpointArena";
import { MiniArena } from "./mini/MiniArena";
import { AdminBar, BossPortrait, Leaderboard, Outcome, fmtDuration } from "./shared";
import styles from "./boss.module.css";

// Kept deliberately low-chatter for a free serverless host: while you're
// clicking, the flush response IS the poll (it returns full state), so we
// don't GET /api/boss at all. We only poll when idle, to see the boss die.
const FLUSH_MS = 2500;
const POLL_IDLE_MS = 6000;
const IDLE_AFTER_MS = 3500; // no clicks for this long -> resume idle polling
const HURT_MS = 130;
const TICK_MS = 66; // ~15fps display refresh, decoupled from click rate

// escalation
const STREAK_GAP_MS = 4000; // over-cap events further apart than this reset the streak
const CAPTCHA_STREAK_HITS = 24; // this many over-cap clicks in one streak -> captcha
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
          body: JSON.stringify({ clicks: n }),
        });
        const data = (await res.json()) as HitResponse;
        // only one flush is ever in flight, so its state is authoritative
        if (data.state) setServer(data.state);
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
      const dmg = inflight * server.dmgPerClick * multRef.current;
      const hpR = Math.ceil(Math.max(0, server.hp - dmg));
      const mineR = Math.round((server.yourDamage + dmg) * 10) / 10;
      setDisplay((d) =>
        d.hp === hpR && d.mine === mineR ? d : { hp: hpR, mine: mineR },
      );
    }, TICK_MS);
    return () => clearInterval(id);
  }, [server.hp, server.yourDamage, server.dmgPerClick]);

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

    if (o.hits >= CAPTCHA_STREAK_HITS || burst >= server.cpsCap * 3) {
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

    pendingRef.current += 1;
    lastClickRef.current = t;
    flashHurt();
  }, [server.cpsCap, flashHurt, registerOverCap]);

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

  const hpPct = Math.max(0, Math.min(100, (display.hp / server.maxHp) * 100));
  const spawnsIn = new Date(server.spawnsAt).getTime() - now;
  const expiresIn = new Date(server.expiresAt).getTime() - now;
  const nextIn = new Date(server.nextSpawnsAt).getTime() - now;

  const adminNote = (
    <AdminBar show={server.viewerIsAdmin} active={server.status === "active"} />
  );

  // ---------- upcoming ----------
  if (server.status === "upcoming") {
    return (
      <div className={styles.card}>
        <p className="eyebrow">The Weekly Raid</p>
        <h1 className={styles.name}>{server.name}</h1>
        {adminNote}
        <BossPortrait image={server.image} name={server.name} dimmed />
        <p className={styles.lead}>
          {server.name} returns in{" "}
          <span className={styles.count}>{fmtDuration(spawnsIn)}</span>.
        </p>
        <p className={styles.sub}>
          {server.blurb ? `${server.blurb} ` : null}
          {server.mechanic === "clicker"
            ? `${server.dmgPerClick} damage a click, ${server.cpsCap} clicks a second. `
            : null}
          {server.maxHp.toLocaleString()} health — fell it and split{" "}
          {server.rewardPool.toLocaleString()} coins by the damage you dealt.
          Fight and fail and you lose {server.penaltyEach.toLocaleString()}.
        </p>
      </div>
    );
  }

  // ---------- ended ----------
  if (server.status === "ended") {
    return (
      <div className={styles.card}>
        <p className="eyebrow">The Weekly Raid</p>
        <h1 className={styles.name}>{server.name}</h1>
        {adminNote}
        <BossPortrait
          image={server.image}
          name={server.name}
          fallen={server.slain}
          dimmed
        />
        {server.slain ? (
          <p className={`${styles.lead} ${styles.won}`}>{server.name} has fallen.</p>
        ) : (
          <p className={`${styles.lead} ${styles.lost}`}>
            {server.name} escaped into the mist.
          </p>
        )}
        <Outcome state={server} />
        <p className={styles.sub}>
          Next raid in <span className={styles.count}>{fmtDuration(nextIn)}</span>.
        </p>
        <Leaderboard top={server.top} />
      </div>
    );
  }

  // ---------- active ----------
  return (
    <div className={styles.card}>
      <p className="eyebrow">
        {server.adminOnly ? "Test Raid — admins only" : "The Weekly Raid — fight now"}
      </p>
      <h1 className={styles.name}>{server.name}</h1>
      {(server.adminOnly || !server.paysOut) && (
        <p className={styles.testFlag}>
          {server.adminOnly && "Only admins can see this fight. "}
          {!server.paysOut && "No coins are paid out for it."}
        </p>
      )}
      {adminNote}

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
            {display.hp.toLocaleString()} / {server.maxHp.toLocaleString()}
          </span>
          <span className="mono">{Math.round(hpPct)}%</span>
        </div>
      </div>

      {phase && (
        <div
          className={`${styles.eclipse} ${
            phase.kind === "dark"
              ? styles.eclipseDark
              : phase.kind === "light"
                ? styles.eclipseLight
                : styles.eclipseNeutral
          }`}
        >
          <span className={styles.eclipseState}>
            {phase.kind === "dark"
              ? "The black sun is open"
              : phase.kind === "light"
                ? "The light drowns your blows"
                : "The dusk holds — clean strikes"}
          </span>
          <span className={styles.eclipseMult}>hits ×{phase.mult}</span>
          <span className={`mono ${styles.eclipseClock}`}>
            {fmtDuration(phase.endsInMs)} →{" "}
            {phase.nextKind === "dark"
              ? "black sun"
              : phase.nextKind === "light"
                ? "the light"
                : "the dusk"}
          </span>
        </div>
      )}

      <div
        className={`${styles.portraitWrap} ${
          phase?.kind === "dark" ? styles.portraitLit : ""
        }`}
      >
        <BossPortrait
          ref={portraitRef}
          image={server.image}
          name={server.name}
          onHit={onHit}
        />
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
                onChange={(e) =>
                  setCaptchaInput(e.target.value.replace(/[^\d]/g, "").slice(0, 3))
                }
                onKeyDown={(e) => e.key === "Enter" && solveCaptcha()}
              />
              <button
                type="button"
                className={styles.captchaBtn}
                onClick={solveCaptcha}
              >
                Continue
              </button>
            </div>
            {captchaBad && (
              <p className={styles.captchaErr}>Not quite — try this one.</p>
            )}
          </div>
        )}
      </div>

      {toast && (
        <p key={toast.key} className={styles.toast}>
          {toast.msg}
        </p>
      )}

      <div className={styles.stats}>
        <span className="rune">
          <Swords size={14} /> {display.mine.toLocaleString()}
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
        Everyone who fights and loses forfeits {server.penaltyEach.toLocaleString()}.
      </p>

      <Leaderboard top={server.top} />
    </div>
  );
}

