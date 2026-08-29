"use client";

import { useState, useTransition } from "react";
import { Coins, Flame, FlaskConical, Loader2, ShieldCheck } from "lucide-react";
import { completeSectionAction } from "./actions";
import type { CompleteResult } from "@/lib/completions";
import styles from "./dashboard.module.css";

type Props = {
  sectionId: string;
  label: string;
  reward: number;
  completed: boolean;
  blurb: string;
};

export function DummySection({
  sectionId,
  label,
  reward,
  completed,
  blurb,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<CompleteResult | null>(null);

  const isDone =
    completed ||
    result?.status === "rewarded" ||
    result?.status === "already_completed";

  function onClick() {
    setResult(null);
    startTransition(async () => {
      setResult(await completeSectionAction(sectionId));
    });
  }

  return (
    <div className={`panel panel--lit ${styles.card}`}>
      <div className={styles.cardTop}>
        <FlaskConical size={24} strokeWidth={1.4} className={styles.cardIcon} />
        <span className={`stamp ${isDone ? "stamp--done" : "stamp--open"}`}>
          {isDone ? <ShieldCheck /> : <Flame />}
          {isDone ? "Bested" : "Open"}
        </span>
      </div>

      <h2 className={styles.cardName}>{label}</h2>
      <p className={styles.cardBlurb}>{blurb}</p>

      <Message result={result} completedOnLoad={completed} />

      <div className={styles.cardFoot}>
        <span className="rune">
          <Coins />
          {reward}
        </span>
        <button
          type="button"
          onClick={onClick}
          disabled={isPending || isDone}
          className="btn btn--sm"
        >
          {isPending && <Loader2 className={styles.spin} />}
          {isPending ? "Working" : isDone ? "Done" : "Mark complete"}
        </button>
      </div>
    </div>
  );
}

function Message({
  result,
  completedOnLoad,
}: {
  result: CompleteResult | null;
  completedOnLoad: boolean;
}) {
  if (!result) {
    return completedOnLoad ? (
      <p className={styles.note}>Already claimed today — returns at midnight.</p>
    ) : null;
  }

  switch (result.status) {
    case "rewarded":
      return (
        <p className={`${styles.note} ${styles.noteGood}`}>
          +{result.amount} claimed · balance {result.newBalance}
        </p>
      );
    case "already_completed":
      return (
        <p className={styles.note}>Already claimed today — no second reward.</p>
      );
    case "reward_failed":
      return (
        <p className={`${styles.note} ${styles.noteBad}`}>
          Something broke — no reward given. Try again. ({result.message})
        </p>
      );
  }
}
