"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameView } from "@/lib/wordle/game";
import type { Mark } from "@/lib/wordle/evaluate";
import type { CompleteResult } from "@/lib/completions";
import styles from "./wordle.module.css";

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const MARK_RANK: Record<Mark, number> = { absent: 1, present: 2, correct: 3 };
const EMPTY_ROW = ["", "", "", "", ""];

function aggregateKeyMarks(rows: GameView["rows"]): Record<string, Mark> {
  const map: Record<string, Mark> = {};
  for (const row of rows) {
    row.guess.split("").forEach((ch, i) => {
      const mark = row.marks[i];
      if (!map[ch] || MARK_RANK[mark] > MARK_RANK[map[ch]]) map[ch] = mark;
    });
  }
  return map;
}

export function WordleBoard({ initialView }: { initialView: GameView }) {
  const [view, setView] = useState(initialView);
  const [current, setCurrent] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reward, setReward] = useState<CompleteResult | null>(null);
  const [revealRow, setRevealRow] = useState(-1);
  const rowCount = useRef(initialView.rows.length);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playing = view.status === "in_progress";
  const canType = playing && !busy;

  const flashError = useCallback((message: string) => {
    setError(message);
    setShake(true);
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShake(false), 500);
  }, []);

  const applyView = useCallback((next: GameView) => {
    if (next.rows.length > rowCount.current) {
      setRevealRow(next.rows.length - 1);
    }
    rowCount.current = next.rows.length;
    setView(next);
  }, []);

  const submitGuess = useCallback(async () => {
    if (busy || !playing) return;
    if (current.length !== 5) {
      flashError("Not enough letters");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/wordle/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guess: current }),
      });
      const data = await res.json();
      if (!res.ok) {
        flashError(data?.error ?? "Something went wrong");
        return;
      }
      applyView(data.view as GameView);
      setReward((data.reward as CompleteResult | null) ?? null);
      setCurrent("");
    } catch {
      flashError("Network error - try again");
    } finally {
      setBusy(false);
    }
  }, [busy, playing, current, flashError, applyView]);

  const handleKey = useCallback(
    (raw: string) => {
      if (!canType) return;
      const key = raw.toLowerCase();
      if (key === "enter") {
        void submitGuess();
      } else if (key === "backspace") {
        setCurrent((c) => c.slice(0, -1));
        setError("");
      } else if (/^[a-z]$/.test(key)) {
        setCurrent((c) => (c.length < 5 ? c + key : c));
        setError("");
      }
    },
    [canType, submitGuess],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Enter" || e.key === "Backspace" || /^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        handleKey(e.key);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleKey]);

  const claimReward = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/wordle/claim", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Could not claim reward");
        return;
      }
      applyView(data.view as GameView);
      setReward((data.reward as CompleteResult | null) ?? null);
    } catch {
      setError("Network error - try again");
    } finally {
      setBusy(false);
    }
  }, [applyView]);

  const keyMarks = aggregateKeyMarks(view.rows);
  const activeRowIndex = playing ? view.rows.length : -1;

  return (
    <div className={styles.board}>
      <div className={styles.grid}>
        {Array.from({ length: view.maxGuesses }).map((_, rowIndex) => {
          const filled = view.rows[rowIndex];
          const isActive = rowIndex === activeRowIndex;
          const letters = filled
            ? filled.guess.split("")
            : isActive
              ? current.padEnd(5).split("")
              : EMPTY_ROW;

          const rowClass = [
            styles.row,
            isActive && shake ? styles.shake : "",
            isActive && busy ? styles.pending : "",
            rowIndex === revealRow ? styles.reveal : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div key={rowIndex} className={rowClass}>
              {letters.map((ch, i) => {
                const mark = filled?.marks[i];
                const cls = [
                  styles.tile,
                  mark ? styles[mark] : "",
                  !mark && ch.trim() ? styles.tileFilled : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <div key={i} className={cls}>
                    {ch.trim()}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <Banner view={view} reward={reward} busy={busy} onClaim={claimReward} />
      <div className={styles.error}>{error}</div>

      <div className={styles.keyboard}>
        {KEY_ROWS.map((rowKeys, r) => (
          <div key={r} className={styles.kbRow}>
            {r === 2 && (
              <button
                className={`${styles.key} ${styles.keyWide}`}
                onClick={() => handleKey("enter")}
                disabled={!canType}
              >
                Enter
              </button>
            )}
            {rowKeys.split("").map((ch) => {
              const mark = keyMarks[ch];
              return (
                <button
                  key={ch}
                  className={`${styles.key} ${mark ? styles[mark] : ""}`}
                  onClick={() => handleKey(ch)}
                  disabled={!canType}
                >
                  {ch}
                </button>
              );
            })}
            {r === 2 && (
              <button
                className={`${styles.key} ${styles.keyWide}`}
                onClick={() => handleKey("backspace")}
                disabled={!canType}
                aria-label="Backspace"
              >
                &#9003;
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Banner({
  view,
  reward,
  busy,
  onClaim,
}: {
  view: GameView;
  reward: CompleteResult | null;
  busy: boolean;
  onClaim: () => void;
}) {
  if (view.status === "in_progress") {
    return <div className={styles.banner} />;
  }

  return (
    <div className={styles.banner}>
      {view.status === "won" ? (
        <span className={styles.bannerWon}>
          Solved in {view.rows.length}/{view.maxGuesses}!
        </span>
      ) : (
        <span className={styles.bannerLost}>
          Out of guesses &mdash; the word was <b>{view.answer?.toUpperCase()}</b>
        </span>
      )}

      {view.status === "won" && (
        <RewardLine view={view} reward={reward} busy={busy} onClaim={onClaim} />
      )}
    </div>
  );
}

function RewardLine({
  view,
  reward,
  busy,
  onClaim,
}: {
  view: GameView;
  reward: CompleteResult | null;
  busy: boolean;
  onClaim: () => void;
}) {
  if (reward?.status === "rewarded") {
    return (
      <span className={styles.reward}>
        +{reward.amount} banked! New balance: {reward.newBalance}
      </span>
    );
  }
  if (view.rewarded) {
    return <span className={styles.reward}>Reward already credited.</span>;
  }
  return (
    <>
      {reward?.status === "reward_failed" && (
        <span className={styles.rewardFailed}>
          Payout failed: {reward.message}
        </span>
      )}
      <button className={styles.button} onClick={onClaim} disabled={busy}>
        {busy ? "Claiming…" : "Claim reward"}
      </button>
    </>
  );
}
