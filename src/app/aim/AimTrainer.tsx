"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./aim.module.css";

const MAX_MISSES = 3; // clicks off every target (or targets left to expire) before the run fails
const TARGET_TTL_MS = 1600; // how long each target stays before it expires as a miss
const MAX_TRIES = 3; // losing runs before the day's challenge is failed

type Phase = "idle" | "countdown" | "playing" | "submitting" | "done";

type StartResponse = {
  targets: { x: number; y: number }[];
  radius: number;
  count: number;
  timeLimitMs: number;
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
  | { ok: true; avgMs: number; totalMs: number; reward: RewardResult }
  | {
      ok: false;
      reason: string;
      avgMs?: number;
      tries?: number;
      maxTries?: number;
      failed?: boolean;
      locked?: boolean;
    };

/** Shown immediately when a run ends client-side, until the server confirms. */
type LocalFail = { ok: false; reason: string; local: true };

type Hit = { i: number; x: number; y: number; t: number };

export function AimTrainer({
  completedToday,
  failedToday,
  triesUsed,
}: {
  completedToday: boolean;
  failedToday: boolean;
  triesUsed: number;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(
    completedToday || failedToday ? "done" : "idle",
  );
  const [locked, setLocked] = useState(failedToday);
  const [tries, setTries] = useState(triesUsed);
  const [round, setRound] = useState<StartResponse | null>(null);
  const [hitCount, setHitCount] = useState(0);
  const [missCount, setMissCount] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [remainingMs, setRemainingMs] = useState(0);
  const [targetNonce, setTargetNonce] = useState(0);
  const [result, setResult] = useState<SubmitResponse | LocalFail | null>(null);
  const [error, setError] = useState("");

  const areaRef = useRef<HTMLDivElement>(null);
  const roundStartRef = useRef<number | null>(null);
  const hitsRef = useRef<Hit[]>([]);
  const missesRef = useRef(0);
  const submittedRef = useRef(false);

  const submit = useCallback(async () => {
    if (submittedRef.current || !round) return;
    submittedRef.current = true;
    setPhase("submitting");
    try {
      const res = await fetch("/api/aim/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: round.token, hits: hitsRef.current }),
      });
      const data = (await res.json()) as SubmitResponse;
      setResult(data);
      if (!data.ok) {
        if (data.failed) setLocked(true);
        if (data.tries != null) setTries(data.tries);
      }
    } catch {
      setError("Network error submitting your round. Try again.");
    } finally {
      setPhase("done");
    }
  }, [round]);

  // A run ended client-side (timeout / misses). Let the server judge and record.
  const failRun = useCallback(
    (reason: string) => {
      if (submittedRef.current) return;
      setResult({ ok: false, local: true, reason });
      void submit();
    },
    [submit],
  );

  // countdown 3..2..1 then start the round clock
  useEffect(() => {
    if (phase !== "countdown") return;
    let n = 3;
    const id = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(id);
        roundStartRef.current = performance.now();
        setRemainingMs(round?.timeLimitMs ?? 0);
        setPhase("playing");
      } else {
        setCountdown(n);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, round]);

  // overall round timer; fail on timeout
  useEffect(() => {
    if (phase !== "playing" || !round) return;
    const id = setInterval(() => {
      if (roundStartRef.current === null) return;
      const left = round.timeLimitMs - (performance.now() - roundStartRef.current);
      setRemainingMs(Math.max(0, left));
      if (left <= 0 && !submittedRef.current) {
        clearInterval(id);
        failRun(
          `Time's up — you cleared ${hitsRef.current.length}/${round.count} targets.`,
        );
      }
    }, 50);
    return () => clearInterval(id);
  }, [phase, round, failRun]);

  // per-target expire clock
  useEffect(() => {
    if (phase !== "playing" || !round || submittedRef.current) return;
    const id = setTimeout(() => {
      if (submittedRef.current) return;
      missesRef.current += 1;
      setMissCount(missesRef.current);
      if (missesRef.current >= MAX_MISSES) {
        failRun(
          `${MAX_MISSES} misses — the run is lost. You cleared ${hitsRef.current.length}/${round.count} targets.`,
        );
      } else {
        setError("too slow!");
        setTargetNonce((n) => n + 1);
      }
    }, TARGET_TTL_MS);
    return () => clearTimeout(id);
  }, [phase, round, hitCount, targetNonce, failRun]);

  async function start() {
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/aim/start", { method: "POST" });
      const data = (await res.json()) as StartResponse;
      setTries(data.tries);
      if (data.alreadyCompleted) {
        setPhase("done");
        return;
      }
      if (data.failed) {
        setLocked(true);
        setPhase("done");
        return;
      }
      submittedRef.current = false;
      hitsRef.current = [];
      missesRef.current = 0;
      roundStartRef.current = null;
      setHitCount(0);
      setMissCount(0);
      setTargetNonce(0);
      setCountdown(3);
      setRound(data);
      setRemainingMs(data.timeLimitMs);
      setPhase("countdown");
    } catch {
      setError("Could not start the round. Try again.");
    }
  }

  function onTargetClick(e: React.MouseEvent) {
    if (phase !== "playing" || !round || !areaRef.current) return;
    if (roundStartRef.current === null) return;
    e.stopPropagation();

    if (error) setError("");
    const rect = areaRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const i = hitsRef.current.length;

    hitsRef.current.push({
      i,
      x,
      y,
      t: performance.now() - roundStartRef.current,
    });
    const next = i + 1;
    setHitCount(next);

    if (next >= round.count) void submit();
  }

  function onAreaMiss() {
    if (phase !== "playing" || !round || submittedRef.current) return;
    missesRef.current += 1;
    setMissCount(missesRef.current);
    if (missesRef.current >= MAX_MISSES) {
      failRun(
        `${MAX_MISSES} misses — the run is lost. You cleared ${hitsRef.current.length}/${round.count} targets.`,
      );
    } else {
      setError("miss!");
    }
  }

  const restart = () => {
    setPhase("idle");
    setResult(null);
    setError("");
  };

  const goToDashboard = () => router.push("/dashboard");

  const triesLeft = Math.max(0, MAX_TRIES - tries);

  if (phase === "done") {
    if (locked) {
      return (
        <div className={styles.card}>
          <div className={styles.resultBlock}>
            <strong className={styles.rejected}>Challenge failed</strong>
            <p>
              That was your last of {MAX_TRIES} tries for today&apos;s aim round.
              Come back after midnight.
            </p>
          </div>
          <button className={styles.button} onClick={goToDashboard}>
            Back to trials
          </button>
        </div>
      );
    }
    const won = result !== null && result.ok;
    return (
      <div className={styles.card}>
        <ResultView
          result={result}
          error={error}
          completedToday={completedToday}
          triesLeft={triesLeft}
        />
        {!(result === null && completedToday) && (
          <button
            className={styles.button}
            onClick={won || triesLeft === 0 ? goToDashboard : restart}
          >
            {won ? "Done" : triesLeft === 0 ? "Back to trials" : "Try again"}
          </button>
        )}
      </div>
    );
  }

  if (phase === "idle") {
    return (
      <div className={styles.card}>
        <p className={styles.lead}>
          Click every target before the timer runs out. There are{" "}
          {round?.count ?? 22}, and a short countdown before it begins. Each
          target vanishes after {(TARGET_TTL_MS / 1000).toFixed(1)}s — let it
          expire and it counts as a miss. {MAX_MISSES} misses fails the run, and
          you get <strong>{MAX_TRIES} tries total</strong> for the day.
        </p>
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.button} onClick={start}>
          Start round {tries > 0 ? `(try ${tries + 1} of ${MAX_TRIES})` : ""}
        </button>
      </div>
    );
  }

  const secondsLeft = remainingMs / 1000;
  const low = phase === "playing" && secondsLeft <= 5;
  const target = round?.targets[Math.min(hitCount, round.count - 1)];

  return (
    <div className={styles.card}>
      <div className={styles.stats}>
        <span>
          {hitCount}/{round?.count}
        </span>
        <span className={low ? styles.timerLow : undefined}>
          {phase === "countdown" ? "get ready" : `${secondsLeft.toFixed(1)}s`}
        </span>
        <span className={missCount > 0 ? styles.missActive : undefined}>
          ✗ {missCount}/{MAX_MISSES}
        </span>
      </div>

      <div ref={areaRef} className={styles.area} onClick={onAreaMiss}>
        {phase === "countdown" && (
          <div className={styles.countdown}>{countdown}</div>
        )}

        {phase === "playing" && target && (
          <button
            key={`${hitCount}-${targetNonce}`}
            type="button"
            className={styles.target}
            onClick={onTargetClick}
            style={
              {
                left: `${target.x * 100}%`,
                top: `${target.y * 100}%`,
                width: `${round!.radius * 2 * 100}%`,
                "--ttl": `${TARGET_TTL_MS}ms`,
              } as React.CSSProperties
            }
            aria-label={`target ${hitCount + 1}`}
          />
        )}

        {phase === "submitting" && (
          <div className={styles.overlay}>Checking your round…</div>
        )}
      </div>

      {phase === "playing" && (error === "miss!" || error === "too slow!") && (
        <p className={styles.hint}>
          {error === "too slow!" ? "Too slow" : "Missed"} —{" "}
          {MAX_MISSES - missCount} left before the run fails.
        </p>
      )}
    </div>
  );
}

function ResultView({
  result,
  error,
  completedToday,
  triesLeft,
}: {
  result: SubmitResponse | LocalFail | null;
  error: string;
  completedToday: boolean;
  triesLeft: number;
}) {
  if (!result) {
    if (error) return <p className={styles.error}>{error}</p>;
    if (completedToday)
      return (
        <p className={styles.lead}>
          You&apos;ve already cleared today&apos;s aim round. Come back after
          midnight.
        </p>
      );
    return null;
  }

  if (!result.ok) {
    return (
      <div className={styles.resultBlock}>
        <strong className={styles.rejected}>
          {"local" in result || !result.reason.includes("rejected")
            ? "Failed"
            : "Round rejected"}
        </strong>
        <p>{result.reason}</p>
        {!("local" in result) && result.avgMs != null && (
          <p className={styles.muted}>{result.avgMs} ms per target</p>
        )}
        <p className={styles.muted}>
          {triesLeft > 0
            ? `${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left today.`
            : "No tries left — no reward today."}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.resultBlock}>
      <strong className={styles.passed}>
        {result.avgMs} ms/target · {(result.totalMs / 1000).toFixed(1)}s total
      </strong>
      <RewardLine reward={result.reward} />
    </div>
  );
}

function RewardLine({ reward }: { reward: RewardResult }) {
  if (reward.status === "rewarded") {
    return (
      <p className={styles.reward}>
        +{reward.amount} banked! New balance: {reward.newBalance}
      </p>
    );
  }
  if (reward.status === "already_completed") {
    return <p className={styles.reward}>Already rewarded today.</p>;
  }
  if (reward.status === "dev_mode") {
    return <p className={styles.muted}>Dev mode — round not recorded, no payout.</p>;
  }
  return (
    <p className={styles.rewardFailed}>
      Cleared, but the payout failed: {reward.message}. Try again to retry it.
    </p>
  );
}
