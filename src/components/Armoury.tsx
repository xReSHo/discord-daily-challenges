"use client";

import { useState } from "react";
import { Check, Lock } from "lucide-react";
import type { Rarity, SlotId } from "@/lib/equipment";
import styles from "./Equipment.module.css";

/**
 * One place in the armoury. What a piece is — its name, its picture, its
 * perk — is only sent for pieces the player has found; the rest arrive as a
 * bare slot and rarity, so nothing is given away before it is earned.
 */
export type ArmouryCell = {
  slot: SlotId;
  rarity: Rarity;
  /** "+9% faster combo": the strength of any piece in this place. */
  stat: string;
  worn: boolean;
  piece?: { id: string; name: string; perk?: string };
};

export type ArmouryAxis = {
  slots: { id: SlotId; name: string; stat: string }[];
  rarities: { id: Rarity; name: string; from: string; again: number }[];
};

const keyOf = (c: { slot: SlotId; rarity: Rarity }) => `${c.slot}:${c.rarity}`;
const artOf = (id: string) => `/art/equipment/${id}-v1`;

/**
 * Every piece there is, as one table: a row for each slot, a column for each
 * rarity, so a glance shows what is found and how much is left to hunt.
 * Pressing a place shows it large. A piece not yet found is a sealed box: it
 * tells how strong it is and where to look, and nothing else.
 */
export function Armoury({ cells, axis }: { cells: ArmouryCell[]; axis: ArmouryAxis }) {
  // open on something the player has, if they have anything
  const first = cells.find((c) => c.worn) ?? cells.find((c) => c.piece) ?? cells[0];
  const [picked, setPicked] = useState(keyOf(first));
  const cell = cells.find((c) => keyOf(c) === picked) ?? first;
  const slot = axis.slots.find((s) => s.id === cell.slot)!;
  const rarity = axis.rarities.find((r) => r.id === cell.rarity)!;
  const found = cells.filter((c) => c.piece).length;

  return (
    <div className={styles.armoury}>
      <header className={styles.armHead}>
        <h3>The armoury</h3>
        <span className={styles.armCount}>
          {found} of {cells.length} found
        </span>
        <span className={styles.armBar} aria-hidden>
          <i style={{ width: `${(found / cells.length) * 100}%` }} />
        </span>
      </header>

      <div className={styles.armBody}>
        <div className={styles.matrix} role="group" aria-label="Every piece of equipment">
          <span />
          {axis.rarities.map((r) => (
            <span key={r.id} className={`${styles.colHead} ${styles[r.id]}`}>
              <i aria-hidden />
              {r.name}
            </span>
          ))}
          {axis.slots.map((s) => (
            <div key={s.id} className={styles.row}>
              <span className={styles.rowHead}>
                {s.name}
                <small>{s.stat}</small>
              </span>
              {axis.rarities.map((r) => {
                const c = cells.find((x) => x.slot === s.id && x.rarity === r.id);
                if (!c) return <span key={r.id} />;
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`${styles.tile} ${styles[r.id]} ${c.piece ? styles.have : styles.lack}`}
                    aria-pressed={picked === keyOf(c)}
                    aria-label={
                      c.piece
                        ? `${c.piece.name}, ${r.name} ${s.name}, found`
                        : `Unknown ${r.name} ${s.name}, not found`
                    }
                    onClick={() => setPicked(keyOf(c))}
                  >
                    {c.piece ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`${artOf(c.piece.id)}-160.webp`}
                        alt=""
                        width={160}
                        height={160}
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                      />
                    ) : (
                      <span className={styles.unknown} aria-hidden>
                        ?
                      </span>
                    )}
                    {c.worn && <b>Worn</b>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <aside
          key={picked}
          className={`${styles.detail} ${styles[cell.rarity]} ${cell.piece ? styles.have : styles.lack}`}
          aria-live="polite"
        >
          <span className={styles.detailArt}>
            {cell.piece ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${artOf(cell.piece.id)}-512.webp`}
                srcSet={`${artOf(cell.piece.id)}-160.webp 160w, ${artOf(cell.piece.id)}-512.webp 512w`}
                sizes="(max-width: 1000px) 84px, 190px"
                alt=""
                width={512}
                height={512}
              />
            ) : (
              <span className={styles.unknownBig} aria-hidden>
                ?
              </span>
            )}
          </span>
          <div className={styles.detailText}>
            <span className={styles.detailKind}>
              {rarity.name} {slot.name}
            </span>
            <strong>{cell.piece ? cell.piece.name : "Unknown"}</strong>
            <span className={styles.detailStat}>{cell.stat}</span>
            {cell.piece?.perk && <p>{cell.piece.perk}</p>}
            {!cell.piece && cell.rarity === "legendary" && <p>It holds a power of its own, known only to its bearer.</p>}
            <span className={styles.detailState}>
              {cell.piece ? (
                <>
                  <Check size={12} /> {cell.worn ? "Found, and worn" : "Found"}
                </>
              ) : (
                <>
                  <Lock size={11} /> Not found yet
                </>
              )}
            </span>
            <dl>
              <div>
                <dt>Found in</dt>
                <dd>{rarity.from}</dd>
              </div>
              <div>
                <dt>Found again</dt>
                <dd>{rarity.again.toLocaleString()} coins</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
