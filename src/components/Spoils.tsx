"use client";

import { useRef, useState } from "react";
import { Dices, X } from "lucide-react";
import { DropRates, type LiveRates } from "./DropRates";
import styles from "./Spoils.module.css";

/**
 * "Spoils": a small button that opens a panel from the side of the screen
 * saying what equipment this trial or raid can give, how likely each rarity
 * is, and what each piece does. It sits inside the game's own page, out of
 * the way of the game itself.
 *
 * The panel is a native dialog, so Escape, the backdrop and focus all behave
 * the way a dialog should without any code of ours.
 */
export function Spoils({ source, className }: { source: "trial" | "boss"; className?: string }) {
  const sheet = useRef<HTMLDialogElement>(null);
  // the chances are set by the admins and can change: read them when the
  // panel is opened. Until they arrive (or if they don't) the usual ones show.
  const [rates, setRates] = useState<LiveRates | null>(null);

  function open() {
    sheet.current?.showModal();
    fetch("/api/drops")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: LiveRates | null) => {
        if (data?.trialOdds && data.duplicateCoins) setRates(data);
      })
      .catch(() => {});
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.open} ${className ?? ""}`}
        onClick={open}
        aria-haspopup="dialog"
      >
        <Dices size={13} /> Spoils
      </button>

      <dialog
        ref={sheet}
        className={styles.sheet}
        aria-label={source === "boss" ? "Spoils of the raid" : "Spoils of the trials"}
        // a press on the dark outside the panel closes it
        onClick={(e) => e.target === sheet.current && sheet.current?.close()}
      >
        <div className={styles.inner}>
          <button type="button" className={styles.close} onClick={() => sheet.current?.close()} aria-label="Close">
            <X size={16} />
          </button>
          <DropRates source={source} rates={rates} />
        </div>
      </dialog>
    </>
  );
}
