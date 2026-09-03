"use client";

import { useTransition } from "react";
import { FlaskConical } from "lucide-react";
import { setDevMode } from "@/app/dev-mode-action";
import styles from "./DevModeToggle.module.css";

/**
 * Admin-only switch in the header. On = the daily cooldown is lifted for this
 * account so games can be replayed while testing (no rewards are paid and
 * nothing is recorded while it's on).
 */
export function DevModeToggle({ on }: { on: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className={`${styles.toggle} ${on ? styles.on : ""}`}
      aria-pressed={on}
      disabled={pending}
      onClick={() => startTransition(() => setDevMode(!on))}
      title={
        on
          ? "Dev mode ON — games have no cooldown and pay nothing. Click to turn off."
          : "Turn on dev mode — replay games with no daily cooldown."
      }
    >
      <FlaskConical size={14} strokeWidth={2} />
      <span className={styles.label}>{on ? "Dev · on" : "Dev"}</span>
    </button>
  );
}
