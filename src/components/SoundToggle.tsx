"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Volume2, VolumeX } from "lucide-react";
import { play, setSfx, sfxOn, watchSfx } from "@/lib/sfx";
import styles from "./DevModeToggle.module.css";

/** Pages where every click is part of a game: no knock on each one. */
const QUIET = ["/boss", "/aim"];

/**
 * The header's sound switch, and the one place the everyday "tap" comes from:
 * it listens for presses on any button or link, so no page has to ask for it.
 * Things that pick between options (`aria-pressed`) get the lighter tick.
 */
export function SoundToggle() {
  const on = useSyncExternalStore(watchSfx, sfxOn, () => true);
  const pathname = usePathname();
  const quiet = QUIET.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    function onPress(e: PointerEvent) {
      const el = (e.target as Element | null)?.closest?.("button, a[href], summary");
      if (!el || el.hasAttribute("data-sfx-own")) return;
      if ((el as HTMLButtonElement).disabled) return;
      if (quiet && !el.closest("header")) return;
      play(el.hasAttribute("aria-pressed") ? "pick" : "tap");
    }
    document.addEventListener("pointerdown", onPress);
    return () => document.removeEventListener("pointerdown", onPress);
  }, [quiet]);

  return (
    <button
      type="button"
      className={styles.toggle}
      aria-pressed={on}
      data-sfx-own
      onClick={() => setSfx(!on)}
      title={on ? "Sound effects on. Click to mute." : "Sound effects off. Click to turn on."}
      aria-label={on ? "Mute sound effects" : "Turn on sound effects"}
    >
      {on ? <Volume2 size={14} strokeWidth={2} /> : <VolumeX size={14} strokeWidth={2} />}
    </button>
  );
}
