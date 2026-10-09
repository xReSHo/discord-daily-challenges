"use client";

import { useEffect, useState } from "react";
import type { BossState } from "@/lib/boss/types";
import { BERSERK_REST_MS, USES_PER_RAID } from "@/lib/boss/kit-rules";
import { gearArt, getGear } from "@/lib/shop/gear";
import { play } from "@/lib/sfx";
import styles from "./KitBar.module.css";

function secs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 90 ? `${Math.ceil(s / 60)}m` : `${s}s`;
}

function Art({ id }: { id: string }) {
  const art = gearArt(id);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={art.src} srcSet={art.srcSet} sizes="40px" alt="" width={40} height={40} draggable={false} />
  );
}

/** Whether there is anything to show: the stage makes room for it if so. */
export function kitShows(state: BossState, now: number): boolean {
  const kit = state.kit;
  if (!kit) return false;
  return (
    kit.on.length > 0 ||
    kit.carry.length > 0 ||
    kit.used > 0 ||
    kit.pact ||
    (state.hornUntil ?? 0) > now
  );
}

/**
 * A fighter's shop gear in the raid: what is at work, what is running, and
 * what they can still use. Using something asks the server, which answers
 * with the whole fight as it now stands.
 */
export function KitBar({
  state,
  onState,
  beforeUse,
}: {
  state: BossState;
  /** the fight as the server left it after something was used */
  onState: (next: BossState) => void;
  /** send any strikes still in hand first, so they land under the old rules */
  beforeUse?: () => Promise<void> | void;
}) {
  const kit = state.kit;
  const horn = state.hornUntil ?? 0;
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ msg: string; bad: boolean } | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(id);
  }, [note]);

  if (!kit || !kitShows(state, now)) return null;
  const hornOn = horn > now;

  const draught = kit.draughtUntil > now;
  const spent = kit.restUntil > now && now >= kit.restUntil - BERSERK_REST_MS;
  const hour = kit.hourUntil > now;
  const usesLeft = Math.max(0, USES_PER_RAID - kit.used);
  const waitMs = Math.max(0, kit.nextUseAt - now);

  async function use(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      await beforeUse?.();
      const res = await fetch("/api/boss/use", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item: id }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; state?: BossState };
      if (data.state) onState(data.state);
      if (data.ok) {
        play("pick");
        setNote({ msg: `${getGear(id)?.name ?? "It"} is used.`, bad: false });
      } else {
        setNote({ msg: data.error ?? "That didn't work.", bad: true });
      }
    } catch {
      setNote({ msg: "Lost contact. Nothing was used.", bad: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.kit}>
      {(draught || spent || hour || hornOn || kit.pact) && (
        <p className={styles.running} aria-live="polite">
          {draught && (
            <span className={styles.fx}>
              ×{kit.draughtMult} damage <b>{secs(kit.draughtUntil - now)}</b>
            </span>
          )}
          {spent && (
            <span className={`${styles.fx} ${styles.fxBad}`}>
              Spent, no blow lands <b>{secs(kit.restUntil - now)}</b>
            </span>
          )}
          {hour && (
            <span className={styles.fx}>
              Combo held <b>{secs(kit.hourUntil - now)}</b>
            </span>
          )}
          {hornOn && (
            <span className={styles.fx}>
              War Horn, +10% for all <b>{secs(horn - now)}</b>
            </span>
          )}
          {kit.pact && <span className={`${styles.fx} ${styles.fxBad}`}>Blood Pact: penalty doubled</span>}
        </p>
      )}

      <div className={styles.row}>
        {kit.on.length > 0 && (
          <ul className={styles.worn} aria-label="Gear at work in this raid">
            {kit.on.map((id) => {
              const g = getGear(id);
              if (!g) return null;
              return (
                <li key={id} title={`${g.name}: ${g.effect}`}>
                  <Art id={id} />
                  <span>
                    {g.name}
                    <small>
                      {id === "steady-hand" ? `${kit.slipsLeft} slip${kit.slipsLeft === 1 ? "" : "s"} left` : g.stat}
                    </small>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {kit.carry.length > 0 && (
          <ul className={styles.uses} aria-label="Gear you can use now">
            {kit.carry.map(({ id, count }) => {
              const g = getGear(id);
              if (!g) return null;
              const limited = g.category === "consumable";
              const blocked = limited && (usesLeft === 0 || waitMs > 0);
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={styles.use}
                    disabled={!!busy || blocked}
                    onClick={() => use(id)}
                    title={g.effect}
                  >
                    <Art id={id} />
                    {count > 1 && <b className={styles.qty}>×{count}</b>}
                    <span>
                      {g.name}
                      <small>{busy === id ? "Using…" : g.stat}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {(kit.carry.some((c) => getGear(c.id)?.category === "consumable") || kit.used > 0) && (
        <p className={styles.limit}>
          {usesLeft} of {USES_PER_RAID} consumables left this raid
          {usesLeft > 0 && waitMs > 0 ? ` · next in ${secs(waitMs)}` : ""}
        </p>
      )}

      {note && <p className={`${styles.note} ${note.bad ? styles.noteBad : ""}`}>{note.msg}</p>}
    </div>
  );
}
