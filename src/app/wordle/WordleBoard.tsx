"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CornerDownLeft, Delete } from "lucide-react";
import type { GameView } from "@/lib/wordle/game";
import type { Mark } from "@/lib/wordle/evaluate";
import type { CompleteResult } from "@/lib/completions";
import { play } from "@/lib/sfx";
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

export function WordleBoard({
  initialView,
  devMode = false,
  initialHints = [],
  insights = 0,
}: {
  initialView: GameView;
  devMode?: boolean;
  /** letters a Wordle Insight has already shown today */
  initialHints?: { pos: number; letter: string }[];
  /** Wordle Insights in the player's pack */
  insights?: number;
}) {
  const [view, setView] = useState(initialView);
  const [hints, setHints] = useState(initialHints);
  const [insightsLeft, setInsightsLeft] = useState(insights);
  const [revealing, setRevealing] = useState(false);
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
      const v = data.view as GameView;
      if (v.status === "won") play("win");
      else if (v.status === "lost") play("lose");
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

  // spend a Wordle Insight: the server names one letter, in its place
  const revealLetter = useCallback(async () => {
    if (revealing) return;
    setRevealing(true);
    try {
      const res = await fetch("/api/wordle/insight", { method: "POST" });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        hint?: { pos: number; letter: string };
        left?: number;
      };
      if (data.ok && data.hint) {
        const hint = data.hint;
        setHints((h) => [...h.filter((x) => x.pos !== hint.pos), hint]);
        setInsightsLeft(data.left ?? 0);
      } else {
        flashError(data.error ?? "That didn't work.");
      }
    } catch {
      flashError("Network error - try again");
    } finally {
      setRevealing(false);
    }
  }, [revealing, flashError]);

  const keyMarks = aggregateKeyMarks(view.rows);
  const activeRowIndex = playing ? view.rows.length : -1;

  const guessNo = Math.min(view.rows.length + 1, view.maxGuesses);

  return (
    <div
      className={styles.board}
      style={{ "--rows": view.maxGuesses } as React.CSSProperties}
    >
      {/* where the game stands: which guess this is, and a mark per guess */}
      <div className={styles.status}>
        <span className={styles.statusLabel}>
          {playing ? (
            <>
              Guess <b>{guessNo}</b> of {view.maxGuesses}
            </>
          ) : view.status === "won" ? (
            "Solved"
          ) : (
            "Out of guesses"
          )}
        </span>
        <span className={styles.pips} aria-hidden="true">
          {Array.from({ length: view.maxGuesses }).map((_, i) => {
            const row = view.rows[i];
            const cls = row
              ? row.marks.every((m) => m === "correct")
                ? styles.pipWon
                : styles.pipUsed
              : i === activeRowIndex
                ? styles.pipNow
                : "";
            return <i key={i} className={`${styles.pip} ${cls}`} />;
          })}
        </span>
      </div>

      <div className={styles.gridWrap}>
        {/* a problem with the guess, shown over the board and gone at the next key */}
        <div className={`${styles.toast} ${error ? styles.toastOn : ""}`} role="status" aria-live="polite">
          {error}
        </div>
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
                  // a letter an Insight has shown, ghosted where it belongs
                  const ghost =
                    isActive && !ch.trim() ? hints.find((h) => h.pos === i)?.letter : undefined;
                  const cls = [
                    styles.tile,
                    mark ? styles[mark] : "",
                    !mark && ch.trim() ? styles.tileFilled : "",
                    // the square the next letter will land in
                    isActive && !busy && i === current.length ? styles.tileNext : "",
                    isActive ? styles.tileLive : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <div key={i} className={cls} style={ghost ? { color: "var(--gold)", opacity: 0.55 } : undefined}>
                      {ch.trim() || ghost}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {playing && (insightsLeft > 0 || hints.length > 0) && (
        <p style={{ textAlign: "center", fontSize: 12.5, color: "var(--ink-dim)" }}>
          {hints.length > 0 && (
            <>
              Insight:{" "}
              {[...hints]
                .sort((a, b) => a.pos - b.pos)
                .map((h) => `letter ${h.pos + 1} is ${h.letter.toUpperCase()}`)
                .join(", ")}
              .{" "}
            </>
          )}
          {insightsLeft > 0 && (
            <button type="button" className="btn btn--quiet btn--sm" disabled={revealing} onClick={revealLetter}>
              {revealing ? "Revealing…" : `Reveal a letter (Wordle Insight ×${insightsLeft})`}
            </button>
          )}
        </p>
      )}

      <div className={styles.result}>
        <Banner view={view} reward={reward} busy={busy} onClaim={claimReward} devMode={devMode} />
      </div>

      <ul className={styles.legend}>
        <li>
          <span className={`${styles.swatch} ${styles.correct}`}>A</span> right place
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.present}`}>B</span> wrong place
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.absent}`}>C</span> not in the word
        </li>
      </ul>

      <div className={styles.keyboard}>
        {KEY_ROWS.map((rowKeys, r) => (
          <div key={r} className={styles.kbRow}>
            {r === 2 && (
              <button
                className={`${styles.key} ${styles.keyWide} ${styles.keyEnter}`}
                onClick={() => handleKey("enter")}
                disabled={!canType}
                aria-label="Enter"
              >
                <CornerDownLeft size={16} />
                <span>Enter</span>
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
                <Delete size={18} />
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
  devMode,
}: {
  view: GameView;
  reward: CompleteResult | null;
  busy: boolean;
  onClaim: () => void;
  devMode: boolean;
}) {
  if (view.status === "in_progress") {
    return (
      <div className={`${styles.banner} ${styles.bannerIdle}`}>
        <span className={styles.hint}>Type a five-letter word, then press Enter.</span>
      </div>
    );
  }

  return (
    <div className={styles.banner}>
      {view.status === "won" ? (
        <span className={styles.bannerWon}>
          Solved in {view.rows.length}/{view.maxGuesses}!
        </span>
      ) : (
        <span className={styles.bannerLost}>
          Challenge failed &mdash; out of guesses. The word was{" "}
          <b>{view.answer?.toUpperCase()}</b>. Back after midnight.
        </span>
      )}

      {devMode ? (
        <>
          <span className={styles.rewardFailed}>
            Dev mode — game not recorded, no payout.
          </span>
          <button
            className={styles.button}
            onClick={() => window.location.reload()}
          >
            Play again
          </button>
        </>
      ) : (
        view.status === "won" && (
          <RewardLine view={view} reward={reward} busy={busy} onClaim={onClaim} />
        )
      )}
      <Link href="/dashboard" className={styles.backLink}>
        <ArrowLeft size={13} /> Back to the trials
      </Link>
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
