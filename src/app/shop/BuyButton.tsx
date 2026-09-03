"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Coins, Lock } from "lucide-react";
import type { WebsiteShopUiItem } from "@/lib/shop";
import styles from "./shop.module.css";

type State = "idle" | "buying" | "done" | "error";

export function BuyButton({ item }: { item: WebsiteShopUiItem }) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  // Non-buyable states render as a plain status, not a button.
  if (item.owned) {
    return (
      <span className={`${styles.buyState} ${styles.buyOwned}`}>
        <BadgeCheck size={13} /> Owned
      </span>
    );
  }
  if (state === "done") {
    return (
      <span className={`${styles.buyState} ${styles.buyOwned}`}>
        <BadgeCheck size={13} /> Purchased
      </span>
    );
  }
  if (item.pending) {
    return (
      <span className={`${styles.buyState} ${styles.buyPending}`}>Processing…</span>
    );
  }
  if (item.comingSoon) {
    return <span className={styles.buyState}>Coming soon</span>;
  }
  if (item.soldOut) {
    return <span className={`${styles.buyState} ${styles.buySoldOut}`}>Sold out</span>;
  }
  if (item.affordable === false) {
    return (
      <span className={`${styles.buyState} ${styles.buyLocked}`}>
        <Lock size={12} strokeWidth={2} /> Not enough coins
      </span>
    );
  }

  async function buy() {
    setState("buying");
    setMessage("");
    try {
      const res = await fetch("/api/shop/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setState("error");
        setMessage(data.error || "Purchase failed. Try again.");
        return;
      }
      setState("done");
      router.refresh();
    } catch {
      setState("error");
      setMessage("Network error. Try again.");
    }
  }

  return (
    <span className={styles.buyWrap}>
      <button
        type="button"
        className={styles.buyBtn}
        onClick={() => void buy()}
        disabled={state === "buying"}
      >
        <Coins size={13} />
        {state === "buying" ? "Buying…" : `Buy · ${item.price.toLocaleString()}`}
      </button>
      {state === "error" && <span className={styles.buyError}>{message}</span>}
    </span>
  );
}
