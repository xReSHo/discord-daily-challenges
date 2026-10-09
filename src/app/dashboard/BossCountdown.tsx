"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./BossCountdown.module.css";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The countdown on the dashboard banner: time until the weekly raid begins, or,
 * while one is under way, until it ends.
 *
 * It is set straight onto the artwork — no box — so it reads as part of the
 * scene. `serverNow` is the server's clock when the page was rendered: the
 * first paint uses it so server and browser agree, then the browser's own clock
 * takes over. When the count reaches zero the page data is refreshed once, so
 * the raid banner appears without a reload.
 */
export function BossCountdown({
  target,
  serverNow,
  live,
}: {
  /** ISO time being counted down to. */
  target: string;
  serverNow: number;
  /** A raid is under way: count down to its end instead. */
  live: boolean;
}) {
  const router = useRouter();
  const end = new Date(target).getTime();
  const [left, setLeft] = useState(() => Math.max(0, end - serverNow));

  useEffect(() => {
    let done = false;
    const tick = () => {
      const ms = Math.max(0, end - Date.now());
      setLeft(ms);
      if (ms === 0 && !done) {
        done = true;
        window.clearInterval(id);
        // give the server a moment to be past the instant too
        window.setTimeout(() => router.refresh(), 1500);
      }
    };
    const id = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(id);
  }, [end, router]);

  const s = Math.floor(left / 1000);
  const parts: [number, string][] = [
    [Math.floor(s / 86400), "days"],
    [Math.floor((s % 86400) / 3600), "hrs"],
    [Math.floor((s % 3600) / 60), "min"],
    [s % 60, "sec"],
  ];

  return (
    <Link href="/boss" className={`${styles.wrap} ${live ? styles.live : ""}`}>
      <span className={styles.label}>
        {live ? "The raid is upon us — ends in" : left === 0 ? "The raid awakens" : "The weekly raid wakes in"}
      </span>
      <span
        className={styles.clock}
        role="timer"
        aria-label={`${parts[0][0]} days ${parts[1][0]} hours ${parts[2][0]} minutes`}
      >
        {parts.map(([n, unit]) => (
          <span key={unit} className={styles.part} aria-hidden="true">
            <span className={styles.num}>{pad(n)}</span>
            <span className={styles.unit}>{unit}</span>
          </span>
        ))}
      </span>
    </Link>
  );
}
