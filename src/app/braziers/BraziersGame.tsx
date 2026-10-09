"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Flame } from "lucide-react";
import { ALL_LIT, CELLS, isLit, litCount, touch, touchMask } from "@/lib/braziers/rules";
import { play } from "@/lib/sfx";
import styles from "./braziers.module.css";

type Phase = "idle" | "starting" | "playing" | "submitting" | "done";

type StartResponse =
  | { state: "completed" }
  | { state: "failed"; tries: number; maxTries: number }
  | {
      state: "ready";
      board: number;
      token: string;
      tries: number;
      maxTries: number;
      par: number;
      cap: number;
    };

type RewardResult =
  | { status: "rewarded"; amount: number; newBalance: number }
  | { status: "already_completed" }
  | { status: "reward_failed"; message: string }
  | { status: "dev_mode" };

type SubmitResponse =
  | { ok: true; touches: number; par: number; reward: RewardResult }
  | { ok: false; reason: string; tries?: number; maxTries?: number; failed?: boolean };

export function BraziersGame({
  completedToday,
  failedToday,
  triesUsed,
  maxTries,
  brief,
}: {
  completedToday: boolean;
  failedToday: boolean;
  triesUsed: number;
  maxTries: number;
  brief: { size: number; par: number; cap: number };
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(completedToday || failedToday ? "done" : "idle");
  const [locked, setLocked] = useState(failedToday);
  const [tries, setTries] = useState({ used: triesUsed, max: maxTries });
  const [board, setBoard] = useState(0);
  const [count, setCount] = useState(0);
  // the braziers the last touch turned over — they flare for a moment
  const [turned, setTurned] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SubmitResponse | null>(null);

  const tokenRef = useRef("");
  const touchesRef = useRef<number[]>([]);
  const submittedRef = useRef(false);
  const turnedTimerRef = useRef<number | null>(null);

  const left = Math.max(0, tries.max - tries.used);

  const submit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setPhase("submitting");
    setError("");
    try {
      const res = await fetch("/api/braziers/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenRef.current, touches: touchesRef.current }),
      });
      const data = (await res.json()) as SubmitResponse;
      if (typeof data?.ok !== "boolean") throw new Error("unexpected reply");
      setResult(data);
      play(data.ok ? "win" : "lose");
      if (!data.ok) {
        if (data.failed) setLocked(true);
        if (data.tries != null && data.maxTries != null) {
          setTries({ used: data.tries, max: data.maxTries });
        }
      }
    } catch {
      // the run is kept, so it can be sent again
      submittedRef.current = false;
      setError("Could not send the run. Check your connection and send it again.");
    } finally {
      setPhase("done");
    }
  }, []);

  async function start() {
    setError("");
    setResult(null);
    setPhase("starting");
    try {
      const res = await fetch("/api/braziers/start", { method: "POST" });
      const reply = (await res.json()) as StartResponse | { state?: undefined; message?: string };
      if (!reply.state) {
        setError(reply.message ?? "Could not open the hall. Try again.");
        setPhase("idle");
        return;
      }
      const data = reply;
      if (data.state === "completed") {
        setPhase("done");
        router.refresh();
        return;
      }
      if (data.state === "failed") {
        setTries({ used: data.tries, max: data.maxTries });
        setLocked(true);
        setPhase("done");
        return;
      }
      tokenRef.current = data.token;
      touchesRef.current = [];
      submittedRef.current = false;
      setTries({ used: data.tries, max: data.maxTries });
      setBoard(data.board);
      setCount(0);
      setTurned(0);
      setPhase("playing");
    } catch {
      setError("Could not open the hall. Try again.");
      setPhase("idle");
    }
  }

  function onTouch(i: number) {
    if (phase !== "playing" || submittedRef.current) return;
    const next = touch(board, i);
    const n = count + 1;
    touchesRef.current.push(i);
    setBoard(next);
    setCount(n);
    setTurned(touchMask(i));
    if (turnedTimerRef.current) window.clearTimeout(turnedTimerRef.current);
    turnedTimerRef.current = window.setTimeout(() => setTurned(0), 260);
    if (next === ALL_LIT || n >= brief.cap) void submit();
  }

  const goToDashboard = () => router.push("/dashboard");

  // ---- render ----

  if (phase === "done") {
    // a run that never reached the server: offer to send it again
    if (error && !result) {
      return (
        <div className={styles.card}>
          <p className={styles.error}>{error}</p>
          <button className={styles.button} onClick={() => void submit()}>
            Send the run again
          </button>
        </div>
      );
    }
    if (locked) {
      return (
        <div className={styles.card}>
          <div className={styles.resultBlock}>
            <strong className={styles.rejected}>The hall stays dark</strong>
            <p>{result?.ok === false ? result.reason : "Today's tries are spent."}</p>
            <p className={styles.muted}>Come back after midnight.</p>
          </div>
          <button className={styles.button} onClick={goToDashboard}>
            Back to trials
          </button>
        </div>
      );
    }
    if (!result) {
      return (
        <div className={styles.card}>
          <p className={styles.lead}>
            You&apos;ve already lit today&apos;s hall. Come back after midnight.
          </p>
        </div>
      );
    }
    if (!result.ok) {
      return (
        <div className={styles.card}>
          <div className={styles.resultBlock}>
            <strong className={styles.rejected}>The fires died</strong>
            <p>{result.reason}</p>
            <p className={styles.muted}>
              {left} {left === 1 ? "try" : "tries"} left — the hall will be as you first found it.
            </p>
          </div>
          <button className={styles.button} onClick={() => void start()}>
            Try again
          </button>
        </div>
      );
    }
    const paidLate = result.reward.status === "reward_failed";
    return (
      <div className={styles.card}>
        <div className={styles.resultBlock}>
          <strong className={styles.passed}>
            {result.touches <= result.par ? "A flawless lighting" : "The hall burns"}
          </strong>
          <p>
            Lit in <b>{result.touches}</b> {result.touches === 1 ? "touch" : "touches"}
            {result.touches <= result.par
              ? " — the fewest there are."
              : ` — it can be done in ${result.par}.`}
          </p>
          <RewardLine reward={result.reward} />
        </div>
        <button
          className={styles.button}
          onClick={() => {
            if (!paidLate) return goToDashboard();
            submittedRef.current = false;
            void submit();
          }}
        >
          {paidLate ? "Claim again" : "Done"}
        </button>
      </div>
    );
  }

  if (phase === "idle" || phase === "starting") {
    return (
      <div className={styles.card}>
        <p className={styles.lead}>
          Touch a brazier and it turns over — lit to dark, dark to lit — along with the ones beside it.
          Set all {brief.size * brief.size} burning.
        </p>
        <ul className={styles.terms}>
          <li>
            <b>{brief.par}</b> touches is the fewest it takes
          </li>
          <li>
            <b>{brief.cap}</b> touches and the run is lost
          </li>
          <li>
            <b>{left}</b> {left === 1 ? "try" : "tries"} left today
          </li>
        </ul>
        <p className={styles.hint}>A try is spent the moment you begin.</p>
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.button} onClick={() => void start()} disabled={phase === "starting"}>
          {phase === "starting" ? "Opening…" : "Enter the hall"}
        </button>
      </div>
    );
  }

  const lit = litCount(board);
  const spare = brief.cap - count;
  return (
    <div className={styles.card}>
      <div className={styles.stats}>
        <span>
          touches <b>{count}</b>/{brief.cap}
        </span>
        <span>
          lit <b>{lit}</b>/{CELLS}
        </span>
        <span className={styles.mute}>
          try {tries.used}/{tries.max}
        </span>
      </div>

      <div
        className={styles.hall}
        style={{ gridTemplateColumns: `repeat(${brief.size}, minmax(0, 1fr))` }}
        role="group"
        aria-label="The hall of braziers"
      >
        {Array.from({ length: CELLS }, (_, i) => {
          const on = isLit(board, i);
          const flare = (turned & (1 << i)) !== 0;
          return (
            <button
              key={i}
              type="button"
              className={`${styles.brazier} ${on ? styles.lit : ""} ${flare ? styles.turned : ""}`}
              onClick={() => onTouch(i)}
              disabled={phase !== "playing"}
              aria-pressed={on}
              aria-label={`Row ${Math.floor(i / brief.size) + 1}, column ${(i % brief.size) + 1}: ${on ? "lit" : "dark"}`}
            >
              <Flame aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <p className={`${styles.hint} ${spare <= 3 ? styles.hintWarn : ""}`}>
        {phase === "submitting"
          ? "Reading the fires…"
          : spare <= 3
            ? `${spare} ${spare === 1 ? "touch" : "touches"} left`
            : "Light every brazier"}
      </p>
      {phase === "playing" && (
        <button className={styles.buttonQuiet} onClick={() => void submit()}>
          Give up this run
        </button>
      )}
    </div>
  );
}

function RewardLine({ reward }: { reward: RewardResult }) {
  if (reward.status === "rewarded") {
    return (
      <p className={styles.reward}>
        +{reward.amount.toLocaleString("en-US")} banked. New balance:{" "}
        {reward.newBalance.toLocaleString("en-US")}
      </p>
    );
  }
  if (reward.status === "already_completed") {
    return <p className={styles.reward}>Already rewarded today.</p>;
  }
  if (reward.status === "dev_mode") {
    return <p className={styles.muted}>Dev mode — run not recorded, no payout.</p>;
  }
  return (
    <p className={styles.rewardFailed}>
      Lit, but the payout failed: {reward.message}. Claim again to retry it.
    </p>
  );
}
