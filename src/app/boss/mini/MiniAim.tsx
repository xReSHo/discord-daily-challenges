"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../boss.module.css";

export type AimHit = { i: number; x: number; y: number; t: number };
export type AimDone = { hits: AimHit[] };

const ASPECT = 3 / 2;

export function MiniAim({
  targets,
  radius,
  count,
  timeLimitMs,
  onDone,
  onCancel,
}: {
  targets: { x: number; y: number }[];
  radius: number;
  count: number;
  timeLimitMs: number;
  onDone: (p: AimDone) => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<"count" | "play">("count");
  const [countLeft, setCountLeft] = useState(3);
  const [idx, setIdx] = useState(0);
  const [leftMs, setLeftMs] = useState(timeLimitMs);

  const t0Ref = useRef(0);
  const hitsRef = useRef<AimHit[]>([]);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone({ hits: hitsRef.current });
  }, [onDone]);

  // countdown — 3 · 2 · 1 · go, all transitions inside timeouts
  useEffect(() => {
    const timers = [
      setTimeout(() => setCountLeft(2), 650),
      setTimeout(() => setCountLeft(1), 1300),
      setTimeout(() => setCountLeft(0), 1950),
      setTimeout(() => {
        t0Ref.current = performance.now();
        setPhase("play");
      }, 2450),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // play timer
  useEffect(() => {
    if (phase !== "play") return;
    const id = setInterval(() => {
      const left = timeLimitMs - (performance.now() - t0Ref.current);
      setLeftMs(left);
      if (left <= 0) finish();
    }, 80);
    return () => clearInterval(id);
  }, [phase, timeLimitMs, finish]);

  const onArea = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (phase !== "play" || doneRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const target = targets[idx];
      const dist = Math.hypot(x - target.x, (y - target.y) / ASPECT);
      if (dist <= radius * 1.5) {
        hitsRef.current.push({
          i: idx,
          x: Number(x.toFixed(4)),
          y: Number(y.toFixed(4)),
          t: Math.round(performance.now() - t0Ref.current),
        });
        if (idx + 1 >= count) finish();
        else setIdx((k) => k + 1);
      }
    },
    [phase, idx, targets, radius, count, finish],
  );

  const target = targets[idx];

  return (
    <div className={styles.miniPlay}>
      <p className={styles.miniPrompt}>
        Strike each mote of light. {count - idx} left ·{" "}
        {Math.max(0, leftMs / 1000).toFixed(1)}s
      </p>
      <div
        className={styles.aimArea}
        onPointerDown={onArea}
        role="presentation"
      >
        {phase === "count" ? (
          <div className={styles.aimCount}>{countLeft > 0 ? countLeft : "go"}</div>
        ) : (
          <span
            className={styles.aimTarget}
            style={{
              left: `${target.x * 100}%`,
              top: `${target.y * 100}%`,
              width: `${radius * 2 * 100}%`,
            }}
          />
        )}
      </div>
      <button type="button" className={styles.miniQuit} onClick={onCancel}>
        Step back
      </button>
    </div>
  );
}
