"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Volume2, VolumeX } from "lucide-react";
import { play, setSfx, sfxOn, watchSfx } from "@/lib/sfx";
import { CHANNELS, levelPct, setLevel, watchLevels, type Channel } from "@/lib/sound-levels";
import toggle from "./DevModeToggle.module.css";
import styles from "./SoundToggle.module.css";

/** Pages where every click is part of a game: no knock on each one. */
const QUIET = ["/boss", "/aim"];

/**
 * The header's sound control: a speaker that opens a small panel with the
 * switch over every sound and a level for each kind (voices, effects, the
 * ambience). It is also the one place the everyday "tap" comes from: it
 * listens for presses on any button or link, so no page has to ask for it.
 * Things that pick between options (`aria-pressed`) get the lighter tick.
 */
export function SoundToggle() {
  const on = useSyncExternalStore(watchSfx, sfxOn, () => true);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
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

  // the panel closes on a click elsewhere, or Escape
  useEffect(() => {
    if (!open) return;
    function away(e: PointerEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <span className={styles.wrap} ref={wrap}>
      <button
        type="button"
        className={toggle.toggle}
        data-sfx-own
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        title="Sound"
        aria-label={on ? "Sound settings (sound on)" : "Sound settings (sound off)"}
      >
        {on ? <Volume2 size={14} strokeWidth={2} /> : <VolumeX size={14} strokeWidth={2} />}
      </button>

      {open && (
        <div className={`panel ${styles.panel}`} role="group" aria-label="Sound">
          <div className={styles.head}>
            <span className={styles.title}>Sound</span>
            <button
              type="button"
              className={`${toggle.toggle} ${on ? toggle.on : ""}`}
              aria-pressed={on}
              data-sfx-own
              onClick={() => setSfx(!on)}
            >
              {on ? "On" : "Off"}
            </button>
          </div>
          {CHANNELS.map((c) => (
            <Level key={c.id} channel={c.id} label={c.label} disabled={!on} />
          ))}
        </div>
      )}
    </span>
  );
}

function Level({ channel, label, disabled }: { channel: Channel; label: string; disabled: boolean }) {
  const pct = useSyncExternalStore(watchLevels, () => levelPct(channel), () => levelPct(channel));
  const id = `sound-${channel}`;
  return (
    <div className={styles.row}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        disabled={disabled}
        className={styles.slider}
        style={{ "--fill": `${pct}%` } as React.CSSProperties}
        onChange={(e) => setLevel(channel, Number(e.target.value))}
        // let go of an Effects slider: hear where it landed
        onPointerUp={() => channel === "fx" && play("pick")}
      />
      <span className={`mono ${styles.value}`}>{pct}%</span>
    </div>
  );
}
