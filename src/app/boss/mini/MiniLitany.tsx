"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../boss.module.css";

export type LitanyDone = { taps: number[]; tapTimes: number[] };

const SIGILS = ["◆", "▲", "●", "★", "■", "✦", "⬟"];

export function MiniLitany({
  sequence,
  glyphs,
  flashOnMs,
  flashGapMs,
  onDone,
  onCancel,
}: {
  sequence: number[];
  glyphs: number;
  flashOnMs: number;
  flashGapMs: number;
  onDone: (p: LitanyDone) => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<"show" | "input">("show");
  const [round, setRound] = useState(1);
  const [lit, setLit] = useState<number | null>(null);
  const [inputPos, setInputPos] = useState(0);

  const tapsRef = useRef<number[]>([]);
  const tapTimesRef = useRef<number[]>([]);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone({ taps: tapsRef.current, tapTimes: tapTimesRef.current });
  }, [onDone]);

  // flash sequence[0..round) then hand over to input
  useEffect(() => {
    if (phase !== "show") return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let t = 350;
    for (let i = 0; i < round; i++) {
      const g = sequence[i];
      timers.push(setTimeout(() => !cancelled && setLit(g), t));
      t += flashOnMs;
      timers.push(setTimeout(() => !cancelled && setLit(null), t));
      t += flashGapMs;
    }
    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        setLit(null);
        setInputPos(0);
        setPhase("input");
      }, t),
    );
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [phase, round, sequence, flashOnMs, flashGapMs]);

  const onGlyph = useCallback(
    (g: number) => {
      if (phase !== "input" || doneRef.current) return;
      tapsRef.current.push(g);
      tapTimesRef.current.push(Math.round(performance.now()));

      if (g !== sequence[inputPos]) {
        finish();
        return;
      }
      const next = inputPos + 1;
      if (next >= round) {
        if (round >= sequence.length) {
          finish();
          return;
        }
        setRound((r) => r + 1);
        setPhase("show");
      } else {
        setInputPos(next);
      }
    },
    [phase, inputPos, round, sequence, finish],
  );

  const ring = Array.from({ length: glyphs }, (_, k) => {
    const ang = (-90 + (k * 360) / glyphs) * (Math.PI / 180);
    return {
      k,
      left: `${50 + Math.cos(ang) * 38}%`,
      top: `${50 + Math.sin(ang) * 38}%`,
    };
  });

  return (
    <div className={styles.miniPlay}>
      <p className={styles.miniPrompt}>
        {phase === "show"
          ? `Read the litany — round ${round}`
          : `Recite it back — ${inputPos}/${round}`}
      </p>
      <div className={styles.litRing}>
        {ring.map(({ k, left, top }) => (
          <button
            key={k}
            type="button"
            className={`${styles.litGlyph} ${lit === k ? styles.litGlyphLit : ""}`}
            style={{ left, top }}
            disabled={phase !== "input"}
            onPointerDown={(e) => {
              e.preventDefault();
              onGlyph(k);
            }}
            aria-label={`sigil ${k + 1}`}
          >
            {SIGILS[k % SIGILS.length]}
          </button>
        ))}
      </div>
      <button type="button" className={styles.miniQuit} onClick={onCancel}>
        Step back
      </button>
    </div>
  );
}
