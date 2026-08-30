"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./aim.module.css";

const MAX_MISSES = 3; // clicks off every target before the run fails

type Phase = "idle" | "countdown" | "playing" | "submitting" | "done";

type StartResponse = {
  targets: { x: number; y: number }[];
  radius: number;
  count: number;
  timeLimitMs: number;
  token: string;
  alreadyCompleted: boolean;
};

type RewardResult =
  | { status: "rewarded"; amount: number; newBalance: number }
  | { status: "already_completed" }
  | { status: "reward_failed"; message: string };

type SubmitResponse =
  | { ok: true; avgMs: number; totalMs: number; reward: RewardResult }
  | { ok: false; reason: string; avgMs?: number };

/** A run that ended before submission (timed out) — shown like a rejection. */
type LocalFail = { ok: false; reason: string; local: true };

type Hit = { i: number; x: number; y: number; t: number };

export function AimTrainer({ completedToday }: { completedToday: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(completedToday ? "done" : "idle");
  const [round, setRound] = useState<StartResponse | null>(null);
  const [hitCount, setHitCount] = useState(0);
  const [missCount, setMissCount] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [remainingMs, setRemainingMs] = useState(0);
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
      setResult((await res.json()) as SubmitResponse);
    } catch {
      setError("Network error submitting your round. Try again.");
    } finally {
      setPhase("done");
    }
  }, [round]);

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

  // countdown timer while playing; fail on timeout
  useEffect(() => {
    if (phase !== "playing" || !round) return;
    const id = setInterval(() => {
      if (roundStartRef.current === null) return;
      const left = round.timeLimitMs - (performance.now() - roundStartRef.current);
      setRemainingMs(Math.max(0, left));
      if (left <= 0 && !submittedRef.current) {
        submittedRef.current = true;
        clearInterval(id);
        setResult({
          ok: false,
          local: true,
          reason: `Time's up — you cleared ${hitsRef.current.length}/${round.count} targets.`,
        });
        setPhase("done");
      }
    }, 50);
    return () => clearInterval(id);
  }, [phase, round]);

  async function start() {
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/aim/start", { method: "POST" });
      const data = (await res.json()) as StartResponse;
      if (data.alreadyCompleted) {
        setPhase("done");
        return;
      }
      submittedRef.current = false;
      hitsRef.current = [];
      missesRef.current = 0;
      roundStartRef.current = null;
      setHitCount(0);
      setMissCount(0);
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
      submittedRef.current = true;
      setResult({
        ok: false,
        local: true,
        reason: `${MAX_MISSES} misses — the run is lost. You cleared ${hitsRef.current.length}/${round.count} targets.`,
      });
      setPhase("done");
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

  if (phase === "done") {
    const won = result !== null && result.ok;
    return (
      <div className={styles.card}>
        <ResultView result={result} error={error} completedToday={completedToday} />
        {!(result === null && completedToday) && (
          <button
            className={styles.button}
            onClick={won ? goToDashboard : restart}
          >
            {won ? "Done" : "Try again"}
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
          {round?.count ?? 20}, and a short countdown before it begins.{" "}
          {MAX_MISSES} clicks off-target fails the run. Clean clicks are
          rewarded; robotic patterns are rejected.
        </p>
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.button} onClick={start}>
          Start round
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

      <div
        ref={areaRef}
        className={styles.area}
        onClick={onAreaMiss}
      >
        {phase === "countdown" && (
          <div className={styles.countdown}>{countdown}</div>
        )}

        {phase === "playing" && target && (
          <button
            type="button"
            className={styles.target}
            onClick={onTargetClick}
            style={{
              left: `${target.x * 100}%`,
              top: `${target.y * 100}%`,
              width: `${round!.radius * 2 * 100}%`,
            }}
            aria-label={`target ${hitCount + 1}`}
          />
        )}

        {phase === "submitting" && (
          <div className={styles.overlay}>Checking your round…</div>
        )}
      </div>

      {phase === "playing" && error === "miss!" && (
        <p className={styles.hint}>
          Missed — {MAX_MISSES - missCount} left before the run fails.
        </p>
      )}
    </div>
  );
}

function ResultView({
  result,
  error,
  completedToday,
}: {
  result: SubmitResponse | LocalFail | null;
  error: string;
  completedToday: boolean;
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
          {"local" in result ? "Failed" : "Round rejected"}
        </strong>
        <p>{result.reason}</p>
        {"avgMs" in result && result.avgMs != null && (
          <p className={styles.muted}>{result.avgMs} ms per target</p>
        )}
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
  return (
    <p className={styles.rewardFailed}>
      Cleared, but the payout failed: {reward.message}. Try again to retry it.
    </p>
  );
}
