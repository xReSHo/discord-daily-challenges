"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./typing.module.css";

type Phase = "idle" | "ready" | "typing" | "submitting" | "done";

const MAX_STRIKES = 3; // strikes before the run auto-fails
const MISTAKE_GRACE_MS = 500; // after a mistake, further wrong keys within this
// window don't add another strike (a slip of two keys, or letter+space, = one)
const MIN_WPM = 30; // live speed floor once warmed up
const WPM_GRACE_SEC = 3; // don't judge speed before this
const WPM_GRACE_CHARS = 15; // ...or before this many characters typed
const IDLE_FAIL_MS = 2500; // stop typing for this long and the run is lost
// (cumulative WPM decays too slowly to catch a fast typist who just stops)

type StartResponse = {
  text: string;
  token: string;
  alreadyCompleted: boolean;
  failed: boolean;
  fails: number;
  prize: number;
};

type SubmitResponse =
  | { ok: true; wpm: number; accuracy: number; reward: RewardResult }
  | {
      ok: false;
      reason: string;
      wpm?: number;
      accuracy?: number;
      fails?: number;
      prize?: number;
      failed?: boolean;
      locked?: boolean;
    };

/** A run that ended before submission — kept only until the server confirms it. */
type LocalFail = { ok: false; reason: string; local: true };

type RewardResult =
  | { status: "rewarded"; amount: number; newBalance: number }
  | { status: "already_completed" }
  | { status: "reward_failed"; message: string }
  | { status: "dev_mode" };

export function TypingTest({
  completedToday,
  failedToday,
  prize: initialPrize,
  basePrize,
}: {
  completedToday: boolean;
  failedToday: boolean;
  prize: number;
  basePrize: number;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(
    completedToday || failedToday ? "done" : "idle",
  );
  const [locked, setLocked] = useState(failedToday);
  const [prize, setPrize] = useState(initialPrize);
  const [text, setText] = useState("");
  const [token, setToken] = useState("");
  const [typed, setTyped] = useState("");
  const [strikes, setStrikes] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SubmitResponse | LocalFail | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const startRef = useRef<number | null>(null);
  const keystrokesRef = useRef(0);
  const strikesRef = useRef(0);
  const lastStrikeAtRef = useRef(0); // performance.now() of the last counted strike
  const lastInputAtRef = useRef(0); // performance.now() of the last keystroke
  const submittedRef = useRef(false);
  const typedRef = useRef("");
  const textRef = useRef("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoStartingRef = useRef(false); // guards the mount auto-start (StrictMode)

  const correctChars = useMemo(() => {
    let n = 0;
    for (let i = 0; i < typed.length; i++) if (typed[i] === text[i]) n++;
    return n;
  }, [typed, text]);

  const liveWpm =
    phase === "typing" && elapsed > 0.5
      ? Math.round(correctChars / 5 / (elapsed / 60))
      : 0;
  const liveAcc = typed.length
    ? Math.round((correctChars / typed.length) * 100)
    : 100;

  const submit = useCallback(
    async (finalTyped: string) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setPhase("submitting");
      const durationMs = startRef.current
        ? performance.now() - startRef.current
        : 0;
      try {
        const res = await fetch("/api/typing/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            typed: finalTyped,
            durationMs,
            keystrokes: keystrokesRef.current,
            strikes: strikesRef.current,
          }),
        });
        const data = (await res.json()) as SubmitResponse;
        setResult(data);
        if (!data.ok) {
          if (data.failed) setLocked(true);
          if (data.prize != null) setPrize(data.prize);
        }
        setPhase("done");
      } catch {
        setError("Network error submitting your result. Try again.");
        setPhase("done");
      }
    },
    [token],
  );

  // A run ended client-side (strikes / idle / too slow). Let the server be the
  // judge — it records the losing attempt and returns the new prize.
  const failLocal = useCallback(
    (reason: string) => {
      if (submittedRef.current) return;
      setResult({ ok: false, reason, local: true });
      void submit(typedRef.current);
    },
    [submit],
  );

  // elapsed clock + live speed-floor check while typing
  useEffect(() => {
    if (phase !== "typing") return;
    const id = setInterval(() => {
      if (!startRef.current) return;
      const secs = (performance.now() - startRef.current) / 1000;
      setElapsed(secs);

      if (
        secs > WPM_GRACE_SEC &&
        lastInputAtRef.current > 0 &&
        performance.now() - lastInputAtRef.current > IDLE_FAIL_MS
      ) {
        failLocal("You stopped typing — run lost.");
        return;
      }

      const t = typedRef.current;
      const g = textRef.current;
      let correct = 0;
      for (let i = 0; i < t.length; i++) if (t[i] === g[i]) correct++;
      const wpm = correct / 5 / (secs / 60);
      if (secs > WPM_GRACE_SEC && t.length >= WPM_GRACE_CHARS && wpm < MIN_WPM) {
        failLocal(`Speed dropped below ${MIN_WPM} WPM.`);
      }
    }, 200);
    return () => clearInterval(id);
  }, [phase, failLocal]);

  const startTest = useCallback(async () => {
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/typing/start", { method: "POST" });
      const data = (await res.json()) as StartResponse;
      setPrize(data.prize);
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
      keystrokesRef.current = 0;
      strikesRef.current = 0;
      lastStrikeAtRef.current = 0;
      lastInputAtRef.current = 0;
      startRef.current = null;
      typedRef.current = "";
      textRef.current = data.text;
      setTyped("");
      setStrikes(0);
      setElapsed(0);
      setText(data.text);
      setToken(data.token);
      setPhase("ready");
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch {
      setError("Could not start the test. Try again.");
    }
  }, []);

  useEffect(() => {
    if (phase !== "idle" || completedToday || failedToday) return;
    if (autoStartingRef.current) return;
    autoStartingRef.current = true;
    void startTest().finally(() => {
      autoStartingRef.current = false;
    });
  }, [phase, completedToday, failedToday, startTest]);

  useEffect(() => {
    if (phase === "ready" || phase === "typing") inputRef.current?.focus();
  }, [phase]);

  const refocusInput = useCallback(() => {
    if (phase === "ready" || phase === "typing") {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [phase]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (phase !== "ready" && phase !== "typing") return;
    if (e.key.length === 1 || e.key === "Backspace") {
      keystrokesRef.current++;
    }
    if (phase === "ready" && e.key.length === 1) {
      startRef.current = performance.now();
      lastInputAtRef.current = performance.now();
      setPhase("typing");
    }
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    if (phase !== "ready" && phase !== "typing") return;
    lastInputAtRef.current = performance.now();
    const next = e.target.value.slice(0, text.length);

    let hasNewMistake = false;
    for (let i = typed.length; i < next.length; i++) {
      if (next[i] !== text[i]) {
        hasNewMistake = true;
        break;
      }
    }
    if (hasNewMistake) {
      const now = performance.now();
      if (now - lastStrikeAtRef.current >= MISTAKE_GRACE_MS) {
        lastStrikeAtRef.current = now;
        strikesRef.current += 1;
        setStrikes(strikesRef.current);
        if (strikesRef.current >= MAX_STRIKES) {
          failLocal(`${MAX_STRIKES} strikes — too many mistakes.`);
        }
      }
    }

    typedRef.current = next;
    setTyped(next);

    if (next.length >= text.length && !submittedRef.current) {
      void submit(next);
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    setError("Pasting is disabled — type it out.");
  }

  const restart = () => {
    setPhase("idle");
    setResult(null);
    setError("");
  };

  const goToDashboard = () => router.push("/dashboard");

  // ---- render ----

  if (phase === "done") {
    if (locked) {
      return (
        <div className={styles.card}>
          <div className={styles.resultBlock}>
            <strong className={styles.rejected}>Challenge failed</strong>
            <p>
              You&apos;ve used up today&apos;s typing attempts. Come back after
              midnight.
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
          prize={prize}
        />
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
          {error
            ? "Couldn't load today's paragraph."
            : "Loading today's paragraph…"}
        </p>
        {error && <p className={styles.error}>{error}</p>}
        {error && (
          <button className={styles.button} onClick={() => void startTest()}>
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.card}>
      {phase === "ready" && (
        <p className={styles.lead}>
          Just start typing — the timer begins on your first keystroke. Pasting
          is blocked, {MAX_STRIKES} mistakes fails the run, and so does dropping
          under {MIN_WPM} WPM.{" "}
          {prize < basePrize
            ? `Today's prize has dropped to ${prize} — a few more fails and it's gone.`
            : `Win it and bank ${prize} coins.`}
        </p>
      )}
      <div className={styles.stats}>
        <span>{Math.floor(elapsed)}s</span>
        <span>{liveWpm} wpm</span>
        <span>{liveAcc}% acc</span>
        <span className={prize < basePrize ? styles.strikeActive : undefined}>
          ◈ {prize}
        </span>
        <span className={strikes > 0 ? styles.strikeActive : undefined}>
          ✗ {strikes}/{MAX_STRIKES}
        </span>
      </div>

      <div
        className={styles.textWrap}
        onMouseDown={(e) => {
          if (e.target !== inputRef.current) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        <div className={styles.display} aria-hidden>
          {text.split("").map((ch, i) => {
            const state =
              i < typed.length
                ? typed[i] === ch
                  ? styles.ok
                  : styles.bad
                : i === typed.length
                  ? styles.caret
                  : styles.pending;
            return (
              <span key={i} className={state}>
                {ch}
              </span>
            );
          })}
        </div>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={typed}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={refocusInput}
          disabled={phase === "submitting"}
          autoFocus
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          aria-label="Type the paragraph here"
        />
      </div>

      {phase === "ready" && (
        <p className={styles.hint}>Start typing when you&apos;re ready…</p>
      )}
      {phase === "submitting" && <p className={styles.hint}>Checking your run…</p>}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

function ResultView({
  result,
  error,
  completedToday,
  prize,
}: {
  result: SubmitResponse | LocalFail | null;
  error: string;
  completedToday: boolean;
  prize: number;
}) {
  if (!result) {
    if (error) return <p className={styles.error}>{error}</p>;
    if (completedToday)
      return (
        <p className={styles.lead}>
          You&apos;ve already completed today&apos;s typing test. Come back
          after midnight.
        </p>
      );
    return null;
  }

  if (!result.ok) {
    const serverFail = !("local" in result);
    return (
      <div className={styles.resultBlock}>
        <strong className={styles.rejected}>
          {serverFail && "reason" in result && result.reason.includes("rejected")
            ? "Run rejected"
            : "Failed"}
        </strong>
        <p>{result.reason}</p>
        {serverFail && "wpm" in result && result.wpm != null && (
          <p className={styles.muted}>
            {result.wpm} wpm
            {result.accuracy != null &&
              ` · ${Math.round(result.accuracy * 100)}% accuracy`}
          </p>
        )}
        <p className={styles.muted}>
          {prize > 0
            ? `Today's prize is now ${prize}. Try again.`
            : "That was the last try — no reward today."}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.resultBlock}>
      <strong className={styles.passed}>
        {result.wpm} wpm · {Math.round(result.accuracy * 100)}% accuracy
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
    return <p className={styles.muted}>Dev mode — run not recorded, no payout.</p>;
  }
  return (
    <p className={styles.rewardFailed}>
      Passed, but the payout failed: {reward.message}. Try again to retry the
      payout.
    </p>
  );
}
