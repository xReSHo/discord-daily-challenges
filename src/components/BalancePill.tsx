"use client";

import { useEffect, useRef, useState } from "react";
import { Coins, Landmark, Wallet } from "lucide-react";
import styles from "./AppFrame.module.css";

/** Short figure for the pill — "91.2K", "67.7T" — so a whale's balance can't
 *  blow out the header. The exact numbers live in the dropdown. */
const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

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

  return (
    <div className={styles.balanceWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.balance}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Show coin balance"
      >
        <Coins size={14} />
        <span className={styles.balanceNum}>{compact.format(total)}</span>
      </button>

      <div
        className={`${styles.balanceMenu} ${open ? styles.balanceMenuOpen : ""}`}
        role="menu"
        aria-hidden={!open}
      >
        <span className={styles.balanceRow}>
          <Wallet size={13} />
          <span>On hand</span>
          <b>{cash.toLocaleString()}</b>
        </span>
        <span className={styles.balanceRow}>
          <Landmark size={13} />
          <span>Banked</span>
          <b>{bank.toLocaleString()}</b>
        </span>
        <span className={`${styles.balanceRow} ${styles.balanceTotal}`}>
          <Coins size={13} />
          <span>Total</span>
          <b>{total.toLocaleString()}</b>
        </span>
      </div>
    </div>
  );
}
