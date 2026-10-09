"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Coins, Landmark, Wallet } from "lucide-react";
import styles from "./AppFrame.module.css";

/** Short figure for the pill — "91.2K", "67.7T" — so a whale's balance can't
 *  blow out the header. The exact numbers live in the purse below it. */
const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** The same figure said aloud — "67.7 trillion" — for the head of the purse. */
const spoken = new Intl.NumberFormat("en", {
  notation: "compact",
  compactDisplay: "long",
  maximumFractionDigits: 1,
});

const exact = (n: number) => n.toLocaleString("en-US");

/** A figure is only worth writing out twice once the short form hides digits. */
const abridged = (n: number) => Math.abs(n) >= 10_000;

function Share({
  icon,
  label,
  value,
  pct,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  pct: number;
}) {
  return (
    <div className={styles.purseShare}>
      <span className={styles.purseLabel}>
        {icon}
        {label}
      </span>
      <b className={styles.purseValue}>{compact.format(value)}</b>
      {abridged(value) && <span className={styles.purseExact}>{exact(value)}</span>}
      <span className={styles.pursePct}>{pct < 1 && value > 0 ? "<1" : Math.round(pct)}%</span>
    </div>
  );
}

export function BalancePill({
  cash,
  bank,
  total,
}: {
  cash: number;
  bank: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const held = Math.max(0, cash) + Math.max(0, bank);
  const cashPct = held > 0 ? (Math.max(0, cash) / held) * 100 : 0;
  const bankPct = held > 0 ? 100 - cashPct : 0;

  return (
    <div className={styles.balanceWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.balance}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Your coins: ${exact(total)}. Show the breakdown`}
      >
        <span className={styles.balanceCoin} aria-hidden="true">
          <Coins size={12} />
        </span>
        <span className={styles.balanceNum}>{compact.format(total)}</span>
        <ChevronDown size={12} className={styles.balanceCaret} aria-hidden="true" />
      </button>

      <div
        className={`${styles.balanceMenu} ${open ? styles.balanceMenuOpen : ""}`}
        role="region"
        aria-label="Your purse"
        aria-hidden={!open}
      >
        <p className={styles.purseEyebrow}>Your purse</p>
        <p className={styles.purseTotal}>
          {abridged(total) ? spoken.format(total) : exact(total)}
          <small>coins</small>
        </p>
        {abridged(total) && <p className={styles.purseTotalExact}>{exact(total)}</p>}

        <div className={styles.purseBar} aria-hidden="true">
          <i style={{ width: `${cashPct}%` }} />
        </div>

        <div className={styles.purseShares}>
          <Share icon={<Wallet size={12} />} label="On hand" value={cash} pct={cashPct} />
          <Share icon={<Landmark size={12} />} label="Banked" value={bank} pct={bankPct} />
        </div>

        <Link
          href="/shop"
          className={styles.purseLink}
          tabIndex={open ? 0 : -1}
          onClick={() => setOpen(false)}
        >
          Spend it at the shop
          <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}
