"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Coins, Users, Swords, Timer } from "lucide-react";
import type { BossState, BossLeader, HitResponse } from "@/lib/boss/types";
import styles from "./boss.module.css";

const POLL_ACTIVE_MS = 2000;
const POLL_IDLE_MS = 15000;
const FLUSH_MS = 1000;
const HURT_MS = 130;
const TICK_MS = 66; // ~15fps display refresh, decoupled from click rate

// escalation
const STREAK_GAP_MS = 4000; // over-cap events further apart than this reset the streak
const CAPTCHA_STREAK_HITS = 24; // this many over-cap clicks in one streak -> captcha
const CAPTCHA_BURST_WINDOW_MS = 1200;

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

type Captcha = { a: number; b: number };
function makeCaptcha(): Captcha {
  const r = () => 2 + Math.floor(Math.random() * 8);
  return { a: r(), b: r() };
}

export function BossArena({ initial }: { initial: BossState }) {
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
  const hitTimesRef = useRef<number[]>([]); // accepted clicks, rolling 1s
  const rawTimesRef = useRef<number[]>([]); // every click incl. rejected, for burst detection
  const overCapRef = useRef({ streakStart: 0, lastAt: 0, hits: 0 });
  const warnedRef = useRef(false);
  const portraitRef = useRef<HTMLButtonElement>(null);
  const hurtTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushingRef = useRef(false);
  const activeRef = useRef(false);
  const captchaRef = useRef(false);

  const active = server.status === "active" && !server.slain;

  // mirror render values into refs for the long-lived intervals
  useEffect(() => {
    activeRef.current = active;
    captchaRef.current = captcha !== null;
  });

  // --- poll shared state ---
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/boss", { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as BossState;
        if (!alive) return;
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
    const id = setInterval(
      poll,
      server.status === "active" ? POLL_ACTIVE_MS : POLL_IDLE_MS,
    );
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
        if (data.ok && typeof data.hp === "number") {
          setServer((prev) => ({
            ...prev,
            hp: data.hp!,
            dealt: data.dealt ?? prev.dealt,
            slain: data.slain ?? prev.slain,
            yourDamage: data.yourDamage ?? prev.yourDamage,
          }));
        } else if (data.state) {
          setServer(data.state);
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
      const dmg = inflight * server.dmgPerClick;
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

  // ---------- upcoming ----------
  if (server.status === "upcoming") {
    return (
      <div className={styles.card}>
        <p className="eyebrow">The Weekly Raid</p>
        <h1 className={styles.name}>{server.name}</h1>
        <BossPortrait dimmed />
        <p className={styles.lead}>
          The Hollow Sovereign returns in{" "}
          <span className={styles.count}>{fmtDuration(spawnsIn)}</span>.
        </p>
        <p className={styles.sub}>
          When he rises, strike him by clicking — {server.dmgPerClick} damage a
          click, {server.cpsCap} clicks a second, {server.maxHp.toLocaleString()}{" "}
          health. Fell him and split {server.rewardPool.toLocaleString()} coins by
          the damage you dealt. Fight and fail and you lose{" "}
          {server.penaltyEach.toLocaleString()}.
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
        <BossPortrait fallen={server.slain} dimmed />
        {server.slain ? (
          <p className={`${styles.lead} ${styles.won}`}>Veyrath has fallen.</p>
        ) : (
          <p className={`${styles.lead} ${styles.lost}`}>
            Veyrath escaped into the mist.
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
      <p className="eyebrow">The Weekly Raid — fight now</p>
      <h1 className={styles.name}>{server.name}</h1>

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

      <div className={styles.portraitWrap}>
        <BossPortrait ref={portraitRef} onHit={onHit} />
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

// portrait is a `button` when hittable so it can hold the imperative hurt ref
const BossPortrait = memo(function BossPortrait({
  ref,
  onHit,
  dimmed,
  fallen,
}: {
  ref?: React.Ref<HTMLButtonElement>;
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
      ref={ref}
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
});

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

const Leaderboard = memo(function Leaderboard({ top }: { top: BossLeader[] }) {
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
