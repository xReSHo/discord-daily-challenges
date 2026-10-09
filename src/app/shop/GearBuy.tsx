"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BadgeCheck, Lock } from "lucide-react";
import type { GearUiItem } from "@/lib/shop";
import { play } from "@/lib/sfx";
import styles from "./shop.module.css";

const WHY: Record<Exclude<GearUiItem["state"], "buy">, string> = {
  soon: "Coming soon",
  full: "Already in your pack",
  kitFull: "You carry part of this",
  soldOut: "Sold out",
  limit: "Bought already",
  poor: "Not enough coins",
};

/** How long "Confirm" waits before the button goes back to "Buy". */
const CONFIRM_MS = 4000;

/**
 * The buy control for a piece of gear. Coins are real, so it takes two
 * presses: "Buy", then "Confirm" within a few seconds. What happens next is
 * said in place — bought and where it went, or why not.
 */
export function GearBuy({
  id,
  name,
  price,
  state,
}: {
  id: string;
  name: string;
  price: number;
  state: GearUiItem["state"];
}) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "confirm" | "buying" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  // an unanswered "Confirm" quietly stands down
  useEffect(() => {
    if (step !== "confirm") return;
    const t = setTimeout(() => setStep("idle"), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [step]);

  if (step === "done") {
    return (
      <Link href="/me#pack" className={`${styles.buyState} ${styles.buyOwned}`}>
        <BadgeCheck size={13} /> In your pack <ArrowRight size={12} />
      </Link>
    );
  }
  if (state !== "buy") {
    return (
      <span className={`${styles.buyState} ${state === "full" ? styles.buyOwned : styles.buyLocked}`}>
        {state === "poor" && <Lock size={12} strokeWidth={2} />}
        {state === "full" && <BadgeCheck size={13} />}
        {WHY[state]}
      </span>
    );
  }

  async function buy() {
    setStep("buying");
    setMessage("");
    try {
      const res = await fetch("/api/shop/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStep("error");
        setMessage(data.error || "Purchase failed. Try again.");
        return;
      }
      setStep("done");
      play("coin");
      router.refresh(); // the purse, the stock and the pack count all change
    } catch {
      setStep("error");
      setMessage("Network error. Try again.");
    }
  }

  return (
    <span className={styles.buyWrap}>
      <button
        type="button"
        className={`${styles.buyBtn} ${step === "confirm" ? styles.buyConfirm : ""}`}
        onClick={() => (step === "confirm" ? void buy() : setStep("confirm"))}
        disabled={step === "buying"}
        aria-label={
          step === "confirm"
            ? `Confirm: buy ${name} for ${price.toLocaleString()} coins`
            : `Buy ${name} for ${price.toLocaleString()} coins`
        }
      >
        {step === "buying" ? "Buying…" : step === "confirm" ? "Confirm purchase" : "Buy"}
      </button>
      {step === "error" && <span className={styles.buyError}>{message}</span>}
    </span>
  );
}
