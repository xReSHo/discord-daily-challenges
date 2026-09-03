"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./litany.module.css";

type Phase = "idle" | "showing" | "input" | "submitting" | "done";

const RUNES = ["ᚠ", "ᚢ", "ᚦ", "ᚨ", "ᚱ", "ᚲ", "ᚷ", "ᛃ", "ᛈ"];

type StartResponse = {
  sequence: number[];
  glyphs: number;
  startRound: number;
  passRound: number;
  maxRound: number;
  flashOnMs: number;
  flashGapMs: number;
  basePrize: number;
  continueBonus: number;
  token: string;
  alreadyCompleted: boolean;
  failed: boolean;
};

type RewardResult =
  | { status: "rewarded"; amount: number; newBalance: number }
  | { status: "already_completed" }
  | { status: "reward_failed"; message: string }
  | { status: "dev_mode" };

type SubmitResponse =
  | { ok: true; round: number; prize: number; reward: RewardResult }
  | { ok: false; reason: string; round?: number; lostPrize?: boolean; locked?: boolean };

export function LitanyGame({
  completedToday,
  failedToday,
}: {
  completedToday: boolean;
  failedToday: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(
    completedToday || failedToday ? "done" : "idle",
  );
  const [locked, setLocked] = useState(failedToday);
  const [cfg, setCfg] = useState<StartResponse | null>(null);
  const [round, setRound] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [inputIdx, setInputIdx] = useState(0);
  const [cleared, setCleared] = useState(0);
  const [bad, setBad] = useState<number | null>(null);
  // the glyph the player just tapped — glows briefly to confirm the choice
  const [picked, setPicked] = useState<number | null>(null);
  const pickTimerRef = useRef<number | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SubmitResponse | null>(null);

  const flashPick = useCallback((g: number) => {
    if (pickTimerRef.current) window.clearTimeout(pickTimerRef.current);
    setPicked(g);
    pickTimerRef.current = window.setTimeout(() => setPicked(null), 100);
  }, []);

  useEffect(
    () => () => {
      if (pickTimerRef.current) window.clearTimeout(pickTimerRef.current);
    },
    [],
  );

  const seqRef = useRef<number[]>([]);
  const tapsRef = useRef<number[]>([]);
  const tapTimesRef = useRef<number[]>([]);
  const submittedRef = useRef(false);

  const glyphs = cfg?.glyphs ?? 7;
  const positions = useMemo(
    () =>
      Array.from({ length: glyphs }, (_, i) => {
        const ang = ((-90 + i * (360 / glyphs)) * Math.PI) / 180;
        return { x: 50 + 42 * Math.cos(ang), y: 50 + 42 * Math.sin(ang) };
      }),
    [glyphs],
  );

  const submit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setActive(null);
    setPhase("submitting");
    try {
      const res = await fetch("/api/litany/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: cfg?.token,
          taps: tapsRef.current,
          tapTimes: tapTimesRef.current,
        }),
      });
      const data = (await res.json()) as SubmitResponse;
      setResult(data);
      if (!data.ok && (data.lostPrize || data.locked)) setLocked(true);
    } catch {
      setError("Network error submitting the rite. Try again.");
    } finally {
      setPhase("done");
    }
  }, [cfg]);

  // play the flashes for the current round, then hand over to input
  useEffect(() => {
    if (phase !== "showing" || !cfg) return;
    const seq = seqRef.current;
    let cancelled = false;
    let i = 0;
    const timers: number[] = [];

    const step = () => {
      if (cancelled) return;
      if (i >= round) {
        setInputIdx(0);
        setActive(null);
        setPhase("input");
        return;
      }
      setActive(seq[i]);
      timers.push(
        window.setTimeout(() => {
          if (cancelled) return;
          setActive(null);
          i += 1;
          timers.push(window.setTimeout(step, cfg.flashGapMs));
        }, cfg.flashOnMs),
      );
    };
    timers.push(
      window.setTimeout(() => {
        setActive(null);
        step();
      }, 560),
    );

    return () => {
      cancelled = true;
      timers.forEach(window.clearTimeout);
    };
  }, [phase, round, cfg]);

  async function start() {
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/litany/start", { method: "POST" });
      const data = (await res.json()) as StartResponse;
      if (data.alreadyCompleted) {
        setPhase("done");
        return;
      }
      if (data.failed) {
        setLocked(true);
        setPhase("done");
        return;
      }
      seqRef.current = data.sequence;
      tapsRef.current = [];
      tapTimesRef.current = [];
      submittedRef.current = false;
      setCfg(data);
      setInputIdx(0);
      setCleared(0);
      setBad(null);
      setPicked(null);
      setActive(null);
      setRound(data.startRound);
      setPhase("showing");
    } catch {
      setError("Could not begin the rite. Try again.");
    }
  }

  const onGlyph = useCallback(
    (g: number) => {
      if (phase !== "input" || submittedRef.current || !cfg) return;
      const seq = seqRef.current;
      tapsRef.current.push(g);
      tapTimesRef.current.push(performance.now());

      if (g !== seq[inputIdx]) {
        setBad(g);
        void submit();
        return;
      }

      flashPick(g);

      const nextIdx = inputIdx + 1;
      if (nextIdx < round) {
        setInputIdx(nextIdx);
        return;
      }

      setCleared(round);
      if (round >= cfg.maxRound) {
        void submit();
        return;
      }
      setInputIdx(round); // freeze the ring for the beat between rounds
      setRound(round + 1);
      setPhase("showing");
    },
    [phase, inputIdx, round, cfg, submit, flashPick],
  );

  const restart = () => {
    setPhase("idle");
    setResult(null);
    setError("");
  };
  const goToDashboard = () => router.push("/dashboard");

  // ---- render ----

  const canSeal =
    (phase === "showing" || phase === "input") &&
    cfg != null &&
    cleared >= cfg.passRound;

  const sealPrize =
    cfg != null
      ? cfg.basePrize + cfg.continueBonus * Math.max(0, cleared - cfg.passRound)
      : 0;

  if (phase === "done") {
    if (locked) {
      const lost = result?.ok === false && result.lostPrize;
      return (
        <div className={styles.card}>
          <div className={styles.resultBlock}>
            <strong className={styles.rejected}>
              {lost ? "The prize is lost" : "Rite failed"}
            </strong>
            <p>
              {result?.ok === false
                ? result.reason
                : "You pushed past the seal and the rite broke earlier today."}
            </p>
            <p className={styles.muted}>Come back after midnight.</p>
          </div>
          <button className={styles.button} onClick={goToDashboard}>
            Back to trials
          </button>
        </div>
      );
    }
    const won = result?.ok === true;
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
          Watch the rite, then recite it back by touching the glyphs in order. It
          grows by one glyph each round. Clear round {cfg?.passRound ?? 10} and
          seal to bank {cfg?.basePrize ?? 200}. Every round past that adds{" "}
          {cfg?.continueBonus ?? 100} more — but slip after round{" "}
          {cfg?.passRound ?? 10} and the whole prize is gone.
        </p>
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.button} onClick={() => void start()}>
          Begin the rite
        </button>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.stats}>
        <span>round {round}</span>
        <span>
          {phase === "showing"
            ? "watch…"
            : phase === "submitting"
              ? "sealing…"
              : `${inputIdx}/${round}`}
        </span>
        {cfg && <span className={styles.mute}>pass {cfg.passRound}</span>}
      </div>

      <div
        className={`${styles.ring} ${phase === "showing" ? styles.ringWatch : ""}`}
      >
        {positions.map((p, i) => {
          const state =
            bad === i
              ? styles.glyphBad
              : active === i
                ? styles.glyphActive
                : picked === i
                  ? styles.glyphPicked
                  : "";
          return (
            <button
              key={i}
              type="button"
              className={`${styles.glyph} ${state}`}
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
              onClick={() => onGlyph(i)}
              disabled={phase !== "input"}
              aria-label={`glyph ${i + 1}`}
            >
              {RUNES[i]}
            </button>
          );
        })}
        <div className={styles.ringCore} aria-hidden>
          {phase === "showing" ? "❖" : phase === "input" ? "◈" : "✦"}
        </div>
      </div>

      {phase === "input" && <p className={styles.hint}>Recite the rite…</p>}
      {canSeal && (
        <>
          <button className={styles.buttonQuiet} onClick={() => void submit()}>
            Seal now · bank {sealPrize}
          </button>
          <p className={styles.hint}>
            Keep going for +{cfg?.continueBonus} a round — a slip now loses it
            all.
          </p>
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

function ResultView({
  result,
  error,
  completedToday,
}: {
  result: SubmitResponse | null;
  error: string;
  completedToday: boolean;
}) {
  if (!result) {
    if (error) return <p className={styles.error}>{error}</p>;
    if (completedToday)
      return (
        <p className={styles.lead}>
          You&apos;ve already recited today&apos;s rite. Come back after midnight.
        </p>
      );
    return null;
  }

  if (!result.ok) {
    return (
      <div className={styles.resultBlock}>
        <strong className={styles.rejected}>The rite broke</strong>
        <p>{result.reason}</p>
        {result.round != null && !result.lostPrize && (
          <p className={styles.muted}>
            reached round {result.round} — didn&apos;t pass. Try again.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.resultBlock}>
      <strong className={styles.passed}>
        Round {result.round} — the rite holds
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
    return <p className={styles.muted}>Dev mode — rite not recorded, no payout.</p>;
  }
  return (
    <p className={styles.rewardFailed}>
      Held, but the payout failed: {reward.message}. Try again to retry it.
    </p>
  );
}
