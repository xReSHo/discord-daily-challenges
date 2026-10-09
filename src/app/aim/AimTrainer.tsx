"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Coins, HeartCrack, RotateCcw, ShieldCheck, Target, Timer, XCircle } from "lucide-react";
import {
  ASPECT,
  clampAspect,
  distance,
  driftY,
  nextDue,
  positionAt,
  reach,
  type AimHit,
  type AimLayout,
} from "@/lib/aim/rules";
import { play } from "@/lib/sfx";
import styles from "./aim.module.css";

type Phase = "idle" | "countdown" | "playing" | "submitting" | "done";

type StartResponse = {
  layout: AimLayout;
  token: string;
  alreadyCompleted: boolean;
  failed: boolean;
  tries: number;
  maxTries: number;
};

type RewardResult =
  | { status: "rewarded"; amount: number; newBalance: number }
  | { status: "already_completed" }
  | { status: "reward_failed"; message: string }
  | { status: "dev_mode" };

type SubmitResponse =
  | { ok: true; avgMs: number; hits: number; misses: number; reward: RewardResult }
  | {
      ok: false;
      reason: string;
      avgMs?: number;
      hits?: number;
      tries?: number;
      maxTries?: number;
      failed?: boolean;
      locked?: boolean;
    };

/** A mark on the board: which one, and how late it was drawn (so its drift
 *  and its fuse start where they should be by now, not from the beginning). */
type Mark = { i: number; lag: number };

/** Something that plays once and is gone: an arrow striking a mark, a mark
 *  slipping away, a shot that hit nothing. */
type Fx = { id: number; kind: "hit" | "lost" | "stray"; x: number; y: number; r: number };

const FX_MS = 620;
/** shards thrown off a struck mark, as angles */
const SHARDS = [20, 85, 150, 205, 270, 330];

/** What the round keeps between renders. The clock, the schedule and the timers
 *  live here, outside React, so nothing about the play waits on a re-render. */
type Engine = {
  layout: AimLayout | null;
  token: string;
  /** the shape of the range for this round (width over height) */
  aspect: number;
  startedAt: number;
  due: number[];
  next: number;
  /** marks on the board -> the timer that takes each away */
  active: Map<number, number>;
  /** the latest moment a mark left the board */
  cleared: number;
  spawnTimer: number;
  hits: AimHit[];
  strays: number;
  lost: number;
  over: boolean;
};

/** ms on the round's clock */
const clockOf = (e: Engine) => performance.now() - e.startedAt;

export function AimTrainer({
  completedToday,
  failedToday,
  triesUsed,
  maxTries: initialMaxTries,
  brief,
}: {
  completedToday: boolean;
  failedToday: boolean;
  triesUsed: number;
  /** Losing rounds allowed per day (set by an admin; the server enforces it). */
  maxTries: number;
  /** the shape of the round, for the briefing shown before it starts */
  brief: { count: number; ttlMs: number; maxMisses: number };
}) {
  const [phase, setPhase] = useState<Phase>(completedToday || failedToday ? "done" : "idle");
  const [locked, setLocked] = useState(failedToday);
  const [tries, setTries] = useState(triesUsed);
  const [maxTries, setMaxTries] = useState(initialMaxTries);
  const [layout, setLayout] = useState<AimLayout | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [fx, setFx] = useState<Fx[]>([]);
  const [hitCount, setHitCount] = useState(0);
  const [missCount, setMissCount] = useState(0);
  const [lostCount, setLostCount] = useState(0);
  const [avgMs, setAvgMs] = useState(0);
  const [countdown, setCountdown] = useState(3);
  // the range's shape and height, fixed for the length of a round
  const [shape, setShape] = useState<{ aspect: number; height: number } | null>(null);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [error, setError] = useState("");

  const areaRef = useRef<HTMLDivElement>(null);
  const fxId = useRef(0);
  const reactSum = useRef(0);
  const eng = useRef<Engine>({
    layout: null,
    token: "",
    aspect: ASPECT,
    startedAt: 0,
    due: [],
    next: 0,
    active: new Map(),
    cleared: 0,
    spawnTimer: 0,
    hits: [],
    strays: 0,
    lost: 0,
    over: true,
  });

  const count = layout?.targets.length ?? brief.count;
  const maxMisses = layout?.maxMisses ?? brief.maxMisses;
  const ttlMs = layout?.ttlMs ?? brief.ttlMs;

  function stopTimers() {
    const e = eng.current;
    window.clearTimeout(e.spawnTimer);
    for (const id of e.active.values()) window.clearTimeout(id);
    e.active.clear();
  }

  // leaving the page mid-round: nothing may fire afterwards
  useEffect(() => {
    const e = eng.current;
    return () => {
      e.over = true;
      window.clearTimeout(e.spawnTimer);
      for (const id of e.active.values()) window.clearTimeout(id);
    };
  }, []);

  function addFx(kind: Fx["kind"], x: number, y: number, r: number) {
    const id = ++fxId.current;
    setFx((list) => [...list.slice(-11), { id, kind, x, y, r }]);
    window.setTimeout(() => setFx((list) => list.filter((f) => f.id !== id)), FX_MS);
  }

  async function submit() {
    const e = eng.current;
    if (e.over) return;
    e.over = true;
    stopTimers();
    setMarks([]);
    setPhase("submitting");
    try {
      const res = await fetch("/api/aim/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: e.token, hits: e.hits, strays: e.strays, aspect: e.aspect }),
      });
      const data = (await res.json()) as SubmitResponse;
      setResult(data);
      play(data.ok ? "win" : "lose");
      if (!data.ok) {
        if (data.failed) setLocked(true);
        if (data.tries != null) setTries(data.tries);
        if (data.maxTries != null) setMaxTries(data.maxTries);
      }
    } catch {
      setError("The round could not be sent. Check your connection and try again.");
    } finally {
      setPhase("done");
    }
  }

  function armSpawn() {
    const e = eng.current;
    window.clearTimeout(e.spawnTimer);
    e.spawnTimer = window.setTimeout(() => spawn(e.next), Math.max(0, e.due[e.next] - clockOf(eng.current)));
  }

  function spawn(i: number) {
    const e = eng.current;
    if (e.over || !e.layout) return;
    const due = e.due[i];
    e.next = i + 1;
    setMarks((m) => [...m, { i, lag: Math.max(0, clockOf(eng.current) - due) }]);
    e.active.set(
      i,
      window.setTimeout(() => expire(i), Math.max(0, due + e.layout.ttlMs - clockOf(eng.current))),
    );
    if (e.next < e.layout.targets.length) {
      // at the latest; sooner if the board is cleared first (see leave)
      e.due[e.next] = due + e.layout.gapMs;
      armSpawn();
    }
  }

  /** A mark is off the board, at `at` on the round's clock. */
  function leave(i: number, at: number) {
    const e = eng.current;
    if (!e.layout) return;
    window.clearTimeout(e.active.get(i));
    e.active.delete(i);
    e.cleared = Math.max(e.cleared, at);
    setMarks((m) => m.filter((x) => x.i !== i));
    if (e.active.size > 0) return;
    if (e.next >= e.layout.targets.length) {
      void submit();
      return;
    }
    // the board is clear: the next mark need not wait out the full gap
    const sooner = nextDue(e.due[e.next - 1], e.cleared, e.layout.gapMs);
    if (sooner < e.due[e.next]) {
      e.due[e.next] = sooner;
      armSpawn();
    }
  }

  /** One more miss; true if that ended the run. */
  function miss(): boolean {
    const e = eng.current;
    const total = e.strays + e.lost;
    setMissCount(total);
    if (e.layout && total >= e.layout.maxMisses) {
      void submit();
      return true;
    }
    return false;
  }

  function expire(i: number) {
    const e = eng.current;
    if (e.over || !e.layout || !e.active.has(i)) return;
    const target = e.layout.targets[i];
    const at = positionAt(target, e.layout.ttlMs, e.aspect);
    addFx("lost", at.x, at.y, target.r);
    e.lost += 1;
    setLostCount(e.lost);
    if (miss()) return;
    leave(i, e.due[i] + e.layout.ttlMs);
  }

  function onMarkDown(ev: React.PointerEvent, i: number) {
    ev.stopPropagation();
    const e = eng.current;
    if (e.over || !e.layout || !e.active.has(i) || !areaRef.current) return;
    const t = clockOf(eng.current);
    const rect = areaRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
    const target = e.layout.targets[i];
    const at = positionAt(target, t - e.due[i], e.aspect);
    // A phone will hand a tap to the nearest mark even when the finger came
    // down well clear of it. That is a miss, and is counted as one here rather
    // than sent as a hit the server would throw the whole run out for.
    if (distance(x, y, at.x, at.y, e.aspect) > reach(target.r, ev.pointerType !== "mouse")) {
      addFx("stray", x, y, 0.03);
      e.strays += 1;
      miss();
      return;
    }
    e.hits.push({ i, x, y, t });
    reactSum.current += t - e.due[i];
    setHitCount(e.hits.length);
    setAvgMs(Math.round(reactSum.current / e.hits.length));
    addFx("hit", at.x, at.y, target.r);
    leave(i, t);
  }

  function onAreaDown(ev: React.PointerEvent) {
    const e = eng.current;
    if (phase !== "playing" || e.over || !areaRef.current) return;
    const rect = areaRef.current.getBoundingClientRect();
    addFx("stray", (ev.clientX - rect.left) / rect.width, (ev.clientY - rect.top) / rect.height, 0.03);
    e.strays += 1;
    miss();
  }

  // 3 · 2 · 1, then the first mark
  useEffect(() => {
    if (phase !== "countdown") return;
    let n = 3;
    const id = window.setInterval(() => {
      n -= 1;
      if (n > 0) {
        setCountdown(n);
        return;
      }
      window.clearInterval(id);
      const e = eng.current;
      // The range's shape is read once, here, and held: every position in the
      // round is worked out against it, on this side and on the server's.
      const rect = areaRef.current?.getBoundingClientRect();
      if (rect && rect.height > 0) {
        e.aspect = clampAspect(rect.width / rect.height);
        setShape({ aspect: e.aspect, height: rect.width / e.aspect });
      }
      e.startedAt = performance.now();
      e.over = false;
      setPhase("playing");
      spawn(0);
    }, 800);
    return () => window.clearInterval(id);
    // spawn only reads the engine, which outlives every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function start() {
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/aim/start", { method: "POST" });
      const data = (await res.json()) as StartResponse;
      setTries(data.tries);
      setMaxTries(data.maxTries);
      if (data.alreadyCompleted) {
        setPhase("done");
        return;
      }
      if (data.failed) {
        setLocked(true);
        setPhase("done");
        return;
      }
      stopTimers();
      eng.current = {
        layout: data.layout,
        token: data.token,
        aspect: ASPECT,
        startedAt: 0,
        due: [0],
        next: 0,
        active: new Map(),
        cleared: 0,
        spawnTimer: 0,
        hits: [],
        strays: 0,
        lost: 0,
        over: true,
      };
      reactSum.current = 0;
      setLayout(data.layout);
      setMarks([]);
      setFx([]);
      setHitCount(0);
      setMissCount(0);
      setLostCount(0);
      setAvgMs(0);
      setCountdown(3);
      setShape(null);
      setPhase("countdown");
    } catch {
      setError("Could not start the round. Try again.");
    }
  }

  const triesLeft = Math.max(0, maxTries - tries);
  // marks dealt with so far, struck or let go
  const resolved = Math.min(count, hitCount + lostCount);
  const live = phase === "playing" || phase === "countdown" || phase === "submitting";

  // On a phone the round takes over the whole screen (see .wrapLive); the page
  // behind must not scroll under a finger while it does.
  useEffect(() => {
    if (!live) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [live]);

  return (
    <div className={`${styles.wrap} ${live ? styles.wrapLive : ""}`}>
      {/* where the round stands */}
      <div className={styles.hud}>
        <div className={styles.hudCell}>
          <span className={styles.hudLabel}>
            <Target size={12} /> Marks
          </span>
          <span className={styles.hudValue}>
            {hitCount}
            <small>/{count}</small>
          </span>
        </div>
        <div className={`${styles.hudCell} ${styles.hudMid}`}>
          <span className={styles.hudLabel}>
            <Timer size={12} /> Reaction
          </span>
          <span className={styles.hudValue}>
            {avgMs > 0 ? avgMs : "—"}
            <small> ms</small>
          </span>
        </div>
        <div className={`${styles.hudCell} ${styles.hudEnd}`}>
          <span className={styles.hudLabel}>
            <HeartCrack size={12} /> Misses left
          </span>
          <span className={styles.pips} aria-label={`${Math.max(0, maxMisses - missCount)} of ${maxMisses}`}>
            {Array.from({ length: maxMisses }).map((_, k) => (
              <i key={k} className={`${styles.pip} ${k < maxMisses - missCount ? "" : styles.pipSpent}`} />
            ))}
          </span>
        </div>
        <span className={styles.progress} aria-hidden="true">
          <span style={{ transform: `scaleX(${live || phase === "done" ? resolved / count : 0})` }} />
        </span>
      </div>

      <div
        ref={areaRef}
        className={`${styles.area} ${phase === "playing" ? styles.areaLive : ""}`}
        style={phase === "playing" && shape ? { height: shape.height, flex: "none" } : undefined}
        onPointerDown={onAreaDown}
      >
        {/* a red edge, once, for every miss */}
        {missCount > 0 && phase === "playing" && <span key={missCount} className={styles.flash} />}

        {layout &&
          marks.map(({ i, lag }) => {
            const t = layout.targets[i];
            const life = layout.ttlMs / 1000;
            return (
              <button
                key={i}
                type="button"
                className={styles.mark}
                onPointerDown={(ev) => onMarkDown(ev, i)}
                aria-label="mark"
                style={
                  {
                    left: `${t.x * 100}%`,
                    top: `${t.y * 100}%`,
                    width: `${t.r * 200}%`,
                    "--ttl": `${layout.ttlMs}ms`,
                    "--lag": `-${Math.round(lag)}ms`,
                    "--dx": `${(t.vx * life * 100).toFixed(2)}cqw`,
                    "--dy": `${(driftY(t, shape?.aspect ?? ASPECT) * life * 100).toFixed(2)}cqh`,
                  } as React.CSSProperties
                }
              >
                <span className={styles.disc} />
                <svg className={styles.fuse} viewBox="0 0 100 100" aria-hidden="true">
                  <circle cx="50" cy="50" r="48" pathLength="100" />
                </svg>
              </button>
            );
          })}

        {fx.map((f) => (
          <span
            key={f.id}
            className={`${styles.fx} ${styles[f.kind]}`}
            style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.r * 200}%` }}
            aria-hidden="true"
          >
            {f.kind === "hit" && (
              <>
                <span className={styles.ghost} />
                <span className={styles.ring} />
                {SHARDS.map((a) => (
                  <span key={a} className={styles.shard} style={{ "--a": `${a}deg` } as React.CSSProperties} />
                ))}
                <span className={styles.arrow} />
              </>
            )}
          </span>
        ))}

        {phase === "countdown" && (
          <div key={countdown} className={styles.countdown}>
            {countdown}
          </div>
        )}

        {phase === "submitting" && <div className={styles.veil}>Judging the round…</div>}

        {phase === "idle" && (
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Strike the marks</h2>
            <ul className={styles.facts}>
              <li>
                <b>{count}</b>
                marks
              </li>
              <li>
                <b>{(ttlMs / 1000).toFixed(1)}s</b>
                each
              </li>
              <li>
                <b>{maxMisses}</b>
                misses end it
              </li>
              <li>
                <b>
                  {triesLeft}
                  <small>/{maxTries}</small>
                </b>
                tries left
              </li>
            </ul>
            <p className={styles.legend}>
              <span className={styles.sizes} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              Three sizes · some drift · fall behind and they pile up
            </p>
            {error && <p className={styles.error}>{error}</p>}
            <button className={styles.button} onClick={start}>
              {tries > 0 ? `Begin · try ${tries + 1} of ${maxTries}` : "Begin"}
            </button>
          </div>
        )}

        {phase === "done" && (
          <Outcome
            result={result}
            error={error}
            locked={locked}
            completedToday={completedToday}
            count={count}
            maxMisses={maxMisses}
            triesLeft={triesLeft}
            maxTries={maxTries}
            onRetry={() => {
              setResult(null);
              setError("");
              setPhase("idle");
            }}
          />
        )}
      </div>
    </div>
  );
}

function Outcome({
  result,
  error,
  locked,
  completedToday,
  count,
  maxMisses,
  triesLeft,
  maxTries,
  onRetry,
}: {
  result: SubmitResponse | null;
  error: string;
  locked: boolean;
  completedToday: boolean;
  count: number;
  maxMisses: number;
  triesLeft: number;
  maxTries: number;
  onRetry: () => void;
}) {
  const back = (
    <Link href="/dashboard" className={styles.backLink}>
      <ArrowLeft size={13} /> Back to the trials
    </Link>
  );

  if (result?.ok) {
    const r = result.reward;
    return (
      <div className={`${styles.card} ${styles.cardWon}`}>
        <p className={styles.verdictWon}>
          <ShieldCheck size={16} /> Trial bested
        </p>
        <p className={styles.big}>
          {result.avgMs}
          <small> ms</small>
        </p>
        <p className={styles.bigLabel}>average reaction</p>
        <ul className={styles.facts}>
          <li>
            <b>
              {result.hits}
              <small>/{count}</small>
            </b>
            marks struck
          </li>
          <li>
            <b>
              {result.misses}
              <small>/{maxMisses}</small>
            </b>
            misses
          </li>
          <li className={styles.factGold}>
            <b>{r.status === "rewarded" ? `+${r.amount.toLocaleString("en-US")}` : "—"}</b>
            coins
          </li>
        </ul>
        {r.status === "already_completed" && <p className={styles.note}>Already rewarded today.</p>}
        {r.status === "dev_mode" && <p className={styles.note}>Dev mode — not recorded, no payout.</p>}
        {r.status === "reward_failed" && (
          <p className={styles.error}>Cleared, but the payout failed: {r.message}. Play again to retry it.</p>
        )}
        {back}
      </div>
    );
  }

  if (locked || (result === null && !completedToday && !error && triesLeft === 0)) {
    return (
      <div className={`${styles.card} ${styles.cardLost}`}>
        <p className={styles.verdictLost}>
          <XCircle size={16} /> Out of tries
        </p>
        <p className={styles.note}>
          All {maxTries} tries are spent. The marks return after midnight.
        </p>
        {back}
      </div>
    );
  }

  if (result) {
    return (
      <div className={`${styles.card} ${styles.cardLost}`}>
        <p className={styles.verdictLost}>
          <XCircle size={16} /> {result.reason.includes("rejected") ? "Round rejected" : "Run lost"}
        </p>
        <ul className={styles.facts}>
          <li>
            <b>
              {result.hits ?? 0}
              <small>/{count}</small>
            </b>
            marks struck
          </li>
          <li>
            <b>{result.avgMs ? result.avgMs : "—"}</b>
            ms reaction
          </li>
          <li>
            <b>
              {triesLeft}
              <small>/{maxTries}</small>
            </b>
            tries left
          </li>
        </ul>
        <p className={styles.note}>{result.reason}</p>
        {triesLeft > 0 ? (
          <button className={styles.button} onClick={onRetry}>
            <RotateCcw size={14} /> Try again
          </button>
        ) : null}
        {back}
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${styles.card} ${styles.cardLost}`}>
        <p className={styles.error}>{error}</p>
        <button className={styles.button} onClick={onRetry}>
          <RotateCcw size={14} /> Try again
        </button>
        {back}
      </div>
    );
  }

  return (
    <div className={`${styles.card} ${styles.cardWon}`}>
      <p className={styles.verdictWon}>
        <ShieldCheck size={16} /> Bested today
      </p>
      <p className={styles.note}>
        <Coins size={13} /> Today&apos;s reward is banked. The marks return after midnight.
      </p>
      {back}
    </div>
  );
}
