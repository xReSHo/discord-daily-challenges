"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { play } from "@/lib/sfx";
import styles from "./dashboard.module.css";

/**
 * Shown when the player carries a Second Chance and has lost a trial it works
 * on: one button per such trial. Using it reopens the trial and reloads the
 * hall.
 */
export function SecondChance({
  count,
  trials,
}: {
  count: number;
  trials: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function use(id: string) {
    if (busy) return;
    setBusy(id);
    setError("");
    try {
      const res = await fetch("/api/charms/second-chance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: id }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        play("pick");
        router.refresh();
      } else {
        setError(data.error ?? "That didn't work.");
      }
    } catch {
      setError("Lost contact. Nothing was used.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`${styles.chance} rise`}>
      <p className={styles.chanceLine}>
        <RotateCcw size={14} />
        You carry {count === 1 ? "a Second Chance" : `${count} Second Chances`}. Spend one to try a
        lost trial again:
      </p>
      <span className={styles.chanceBtns}>
        {trials.map((t) => (
          <button
            key={t.id}
            type="button"
            className="btn btn--quiet btn--sm"
            disabled={!!busy}
            onClick={() => use(t.id)}
          >
            {busy === t.id ? "Reopening…" : t.label}
          </button>
        ))}
      </span>
      {error && <p className={styles.chanceErr}>{error}</p>}
    </div>
  );
}
