"use client";

import { useState } from "react";
import type { HeatCell } from "@/lib/profile";
import styles from "./YourRecord.module.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Challenge days are UTC dates; read them as such so the labels never shift
// with the viewer's own time zone.
const parse = (date: string) => new Date(`${date}T00:00:00Z`);

function level(count: number): string {
  if (count <= 0) return styles.lvl0;
  if (count === 1) return styles.lvl1;
  if (count === 2) return styles.lvl2;
  if (count === 3) return styles.lvl3;
  return styles.lvl4;
}

function describe(c: HeatCell): string {
  const d = parse(c.date);
  const day = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  if (c.count <= 0) return `${day} · no trials`;
  return `${day} · ${c.count} trial${c.count === 1 ? "" : "s"} bested`;
}

/**
 * The last 17 weeks, a column per week. Pointing at a day (or tapping it)
 * reads it out underneath.
 */
export function RecordCalendar({ heat }: { heat: HeatCell[] }) {
  const [picked, setPicked] = useState<number | null>(null);
  const weeks = Math.ceil(heat.length / 7);

  const pick = (e: React.SyntheticEvent) => {
    const i = (e.target as HTMLElement).dataset?.i;
    if (i !== undefined) setPicked(Number(i));
  };

  // a month's name over the first week that starts in it
  const months: { col: number; label: string }[] = [];
  for (let w = 0; w < weeks; w++) {
    const m = parse(heat[w * 7].date).getUTCMonth();
    const before = w === 0 ? -1 : parse(heat[(w - 1) * 7].date).getUTCMonth();
    // skip a label that would collide with the one just before it
    if (m !== before && (months.length === 0 || w - months[months.length - 1].col >= 3 || w === 0)) {
      months.push({ col: w, label: MONTHS[m] });
    }
  }

  return (
    <>
      <div
        className={styles.cal}
        style={{ "--weeks": weeks } as React.CSSProperties}
        onPointerOver={pick}
        onClick={pick}
        onPointerLeave={(e) => e.pointerType === "mouse" && setPicked(null)}
      >
        {months.map((m) => (
          <span key={m.col} className={styles.calMonth} style={{ gridColumn: m.col + 2, gridRow: 1 }}>
            {m.label}
          </span>
        ))}
        {[0, 2, 4, 6].map((r) => (
          <span key={r} className={styles.calDay} style={{ gridColumn: 1, gridRow: r + 2 }}>
            {DAYS[parse(heat[r].date).getUTCDay()]}
          </span>
        ))}
        {heat.map((c, i) => (
          <span
            key={c.date}
            data-i={i}
            className={`${styles.cell} ${level(c.count)} ${picked === i ? styles.cellOn : ""}`}
            style={
              {
                gridColumn: Math.floor(i / 7) + 2,
                gridRow: (i % 7) + 2,
                "--c": Math.floor(i / 7),
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      <div className={styles.calFoot}>
        <p className={styles.calRead} aria-live="polite">
          {picked === null ? "Point at a day to read it" : describe(heat[picked])}
        </p>
        <p className={styles.legend} aria-hidden="true">
          less
          <span className={`${styles.cell} ${styles.lvl0}`} />
          <span className={`${styles.cell} ${styles.lvl1}`} />
          <span className={`${styles.cell} ${styles.lvl2}`} />
          <span className={`${styles.cell} ${styles.lvl4}`} />
          more
        </p>
      </div>
    </>
  );
}
