"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./typing.module.css";

type Phase = "idle" | "ready" | "typing" | "submitting" | "done";

const MAX_STRIKES = 3; // strikes before the run auto-fails
const MISTAKE_GRACE_MS = 500; // after a mistake, further wrong keys within this
// window don't add another strike (a slip of two keys, or letter+space, = one)
const MIN_WPM = 30; // live speed floor once warmed up
const WPM_GRACE_SEC = 3; // don't judge speed before this
const WPM_GRACE_CHARS = 15; // ...or before this many characters typed

type StartResponse = {
  text: string;
  token: string;
  alreadyCompleted: boolean;
};

type SubmitResponse =
  | { ok: true; wpm: number; accuracy: number; reward: RewardResult }
  | { ok: false; reason: string; wpm?: number; accuracy?: number };

/** A run that ended before submission (strikes / too slow). */
type LocalFail = { ok: false; reason: string; local: true };

type RewardResult =
  | { status: "rewarded"; amount: number; newBalance: number }
  | { status: "already_completed" }
  | { status: "reward_failed"; message: string };

export function TypingTest({ completedToday }: { completedToday: boolean }) {
  const [phase, setPhase] = useState<Phase>(completedToday ? "done" : "idle");
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
  const submittedRef = useRef(false);
  const typedRef = useRef("");
  const textRef = useRef("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const failLocal = useCallback((reason: string) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setResult({ ok: false, reason, local: true });
    setPhase("done");
  }, []);

  // elapsed clock + live speed-floor check while typing
  useEffect(() => {
    if (phase !== "typing") return;
    const id = setInterval(() => {
      if (!startRef.current) return;
      const secs = (performance.now() - startRef.current) / 1000;
      setElapsed(secs);

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
        setResult((await res.json()) as SubmitResponse);
        setPhase("done");
      } catch {
        setError("Network error submitting your result. Try again.");
        setPhase("done");
      }
    },
    [token],
  );

  async function startTest() {
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/typing/start", { method: "POST" });
      const data = (await res.json()) as StartResponse;
      if (data.alreadyCompleted) {
        setPhase("done");
        return;
      }
      submittedRef.current = false;
      keystrokesRef.current = 0;
      strikesRef.current = 0;
      lastStrikeAtRef.current = 0;
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
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (phase !== "ready" && phase !== "typing") return;
    if (e.key.length === 1 || e.key === "Backspace") {
      keystrokesRef.current++;
    }
    if (phase === "ready" && e.key.length === 1) {
      startRef.current = performance.now();
      setPhase("typing");
    }
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    if (phase !== "ready" && phase !== "typing") return;
    const next = e.target.value.slice(0, text.length);

    // Any newly-added wrong characters count as ONE strike, and only if we're
    // past the grace window since the last one — so a two-key slip, or a wrong
    // letter followed by space, is a single strike, not two.
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

  // ---- render ----

  if (phase === "done") {
    return (
      <div className={styles.card}>
        <ResultView result={result} error={error} completedToday={completedToday} />
        {!(result === null && completedToday) && (
          <button className={styles.button} onClick={restart}>
            {result && result.ok ? "Done" : "Try again"}
          </button>
        )}
      </div>
    );
  }

  if (phase === "idle") {
    return (
      <div className={styles.card}>
        <p className={styles.lead}>
          Type the paragraph exactly. The timer starts on your first keystroke.
          Pasting is blocked, {MAX_STRIKES} mistakes fails the run, and so does
          dropping under {MIN_WPM} WPM. A quick slip of a couple of keys counts
          as one mistake.
        </p>
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.button} onClick={startTest}>
          Start test
        </button>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.stats}>
        <span>{Math.floor(elapsed)}s</span>
        <span>{liveWpm} wpm</span>
        <span>{liveAcc}% acc</span>
        <span className={strikes > 0 ? styles.strikeActive : undefined}>
          ✗ {strikes}/{MAX_STRIKES}
        </span>
      </div>

      <div className={styles.textWrap}>
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
          disabled={phase === "submitting"}
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
          You&apos;ve already completed today&apos;s typing test. Come back
          after midnight.
        </p>
      );
    return null;
  }

  if (!result.ok) {
    return (
      <div className={styles.resultBlock}>
        <strong className={styles.rejected}>
          {"local" in result ? "Failed" : "Run rejected"}
        </strong>
        <p>{result.reason}</p>
        {"wpm" in result && result.wpm != null && (
          <p className={styles.muted}>
            {result.wpm} wpm
            {result.accuracy != null &&
              ` · ${Math.round(result.accuracy * 100)}% accuracy`}
          </p>
        )}
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
        +{reward.amount} cash! New balance: {reward.newBalance}
      </p>
    );
  }
  if (reward.status === "already_completed") {
    return <p className={styles.reward}>Already rewarded today.</p>;
  }
  return (
    <p className={styles.rewardFailed}>
      Passed, but the payout failed: {reward.message}. Try again to retry the
      payout.
    </p>
  );
}
