import { Shield } from "lucide-react";
import {
  BONUS,
  DUPLICATE_COINS,
  EQUIPMENT,
  RARITIES,
  SLOTS,
  bestLoadout,
  pieceArt,
  pieceBonus,
  rarityName,
  type Loadout,
  type Rarity,
  type SlotId,
} from "@/lib/equipment";
import { getOwned } from "@/lib/equipment-drops";
import { getDropSettings } from "@/lib/site-settings";
import { Armoury, type ArmouryAxis, type ArmouryCell } from "./Armoury";
import styles from "./Equipment.module.css";

/** A player's equipment, read from what they own. One small query. */
export async function Equipment({ discordId }: { discordId: string }) {
  const [owned, drops] = await Promise.all([getOwned(discordId), getDropSettings()]);
  return <EquipmentView owned={owned} again={drops.duplicateCoins} />;
}

/** The armoury's rows and columns. `again` is what a repeat find pays, by rarity. */
const axis = (again: Record<Rarity, number>): ArmouryAxis => ({
  slots: SLOTS.map((s) => ({ id: s.id, name: s.name, stat: s.stat })),
  rarities: RARITIES.map((r) => ({ id: r.id, name: r.name, from: r.from, again: again[r.id] })),
});

/** Which slots stand on which side of the figure, top to bottom. */
const LEFT: SlotId[] = ["helm", "chest", "boots"];
const RIGHT: SlotId[] = ["amulet", "sword", "gauntlets"];

function SlotCard({ id, loadout }: { id: SlotId; loadout: Loadout }) {
  const slot = SLOTS.find((s) => s.id === id)!;
  const piece = loadout[id];
  const art = piece && pieceArt(piece.id);
  return (
    <li className={`${styles.slot} ${piece ? styles[piece.rarity] : styles.bare}`} tabIndex={0}>
      <span className={styles.frame}>
        {art && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art.src} srcSet={art.srcSet} sizes="84px" alt="" width={160} height={160} draggable={false} />
        )}
      </span>
      <span className={styles.text}>
        <span className={styles.slotName}>
          {slot.name}
          {piece && <b>{rarityName(piece.rarity)}</b>}
        </span>
        {piece ? (
          <>
            <span className={styles.name}>{piece.name}</span>
            <span className={styles.stat}>
              +{pieceBonus(piece)}% {slot.does}
            </span>
            {piece.perk && <span className={styles.perk}>{piece.perk}</span>}
          </>
        ) : (
          <>
            <span className={styles.none}>Empty</span>
            <span className={styles.gives}>
              {slot.stat}: up to +{BONUS[id].legendary}% {slot.does}
            </span>
          </>
        )}
      </span>
    </li>
  );
}

/** The painted figure. Set `hasFigure` once the file is in public/art/equipment. */
const FIGURE = "/art/equipment/figure-v1-512.webp";
const hasFigure: boolean = false;

/**
 * The figure the equipment stands around, in a niche: the painting if it
 * exists, otherwise a drawn knight at rest.
 */
function Figure({ worn }: { worn: number }) {
  if (hasFigure) {
    return (
      <div className={styles.figure} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={FIGURE} alt="" width={512} height={512} className={styles.figureArt} draggable={false} />
        <span className={styles.figureCount}>
          <b>{worn}</b> of {SLOTS.length} worn
        </span>
      </div>
    );
  }
  return (
    <div className={styles.figure} aria-hidden>
      <svg viewBox="0 0 200 360" className={styles.knight}>
        <defs>
          <linearGradient id="eq-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2b2317" />
            <stop offset="1" stopColor="#100d09" />
          </linearGradient>
          <linearGradient id="eq-blade" gradientUnits="userSpaceOnUse" x1="0" y1="150" x2="0" y2="346">
            <stop offset="0" stopColor="#ecca77" />
            <stop offset="1" stopColor="#8a6c30" stopOpacity="0.5" />
          </linearGradient>
        </defs>
        {/* cloak, behind */}
        <path
          d="M100 78 C70 80 52 96 48 128 L38 300 Q36 326 60 332 L140 332 Q164 326 162 300 L152 128 C148 96 130 80 100 78Z"
          fill="#0d0b08"
          stroke="#2e271c"
        />
        {/* body */}
        <path
          d="M100 14 C114 14 122 26 122 42 L120 60 Q118 68 110 72 L112 78 C132 80 150 86 156 102 L160 150 Q160 166 150 172 L132 200 L136 236 L132 300 L142 338 L106 338 L104 252 L100 246 L96 252 L94 338 L58 338 L68 300 L64 236 L68 200 L50 172 Q40 166 40 150 L44 102 C50 86 68 80 88 78 L90 72 Q82 68 80 60 L78 42 C78 26 86 14 100 14Z"
          fill="url(#eq-body)"
          stroke="#6a5730"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        {/* the lines of the armour */}
        <g fill="none" stroke="#6a5730" strokeWidth="1" strokeLinecap="round" opacity="0.8">
          <path d="M86 40 L114 40" strokeWidth="2.4" stroke="#0b0906" />
          <path d="M100 14 L100 34" />
          <path d="M80 58 Q100 68 120 58" />
          <path d="M56 104 Q72 96 80 112 M144 104 Q128 96 120 112" />
          <path d="M70 200 L130 200 M66 236 L134 236" />
          <path d="M72 130 Q100 146 128 130" />
        </g>
        {/* the sword, point down, hands resting on it */}
        <g stroke="url(#eq-blade)" strokeLinecap="round" fill="none">
          <path d="M100 150 L100 346" strokeWidth="3.2" />
          <path d="M80 176 L120 176" strokeWidth="3.2" />
        </g>
        <circle cx="100" cy="146" r="4.5" fill="#ecca77" />
        <ellipse cx="100" cy="162" rx="13" ry="8" fill="#1c1710" stroke="#6a5730" />
      </svg>
      <span className={styles.figureCount}>
        <b>{worn}</b> of {SLOTS.length} worn
      </span>
    </div>
  );
}

/**
 * What the player is wearing — the best piece they own for each slot — set
 * around a figure, then what it adds up to, then the armoury. An empty slot
 * says what it would give, so the page explains the system before the player
 * owns anything.
 */
export function EquipmentView({
  owned,
  sample,
  again = DUPLICATE_COINS,
}: {
  owned: Set<string>;
  sample?: boolean;
  again?: Record<Rarity, number>;
}) {
  const loadout = bestLoadout(owned);
  const worn = SLOTS.filter((s) => loadout[s.id]);
  // what a piece is goes to the browser only once the player has found it
  const cells: ArmouryCell[] = EQUIPMENT.map((x) => ({
    slot: x.slot,
    rarity: x.rarity,
    stat: `+${pieceBonus(x)}% ${SLOTS.find((s) => s.id === x.slot)!.does}`,
    worn: loadout[x.slot]?.id === x.id,
    piece: owned.has(x.id) ? { id: x.id, name: x.name, perk: x.perk } : undefined,
  }));

  return (
    <section id="equipment" className={`${styles.equipment} rise`}>
      <header className={styles.head}>
        <h2 className={styles.title}>
          <Shield size={15} /> Your equipment
        </h2>
        {sample ? (
          <span className={styles.sample}>Admin preview · not your real pieces</span>
        ) : (
          <span className={styles.how}>Found in daily trials and on slain bosses. You wear your best.</span>
        )}
      </header>

      <div className={styles.doll}>
        <ul className={`${styles.side} ${styles.sideLeft}`}>
          {LEFT.map((id) => (
            <SlotCard key={id} id={id} loadout={loadout} />
          ))}
        </ul>
        <Figure worn={worn.length} />
        <ul className={`${styles.side} ${styles.sideRight}`}>
          {RIGHT.map((id) => (
            <SlotCard key={id} id={id} loadout={loadout} />
          ))}
        </ul>
      </div>

      <dl className={styles.totals} aria-label="What your equipment adds up to">
        {SLOTS.map((slot) => {
          const piece = loadout[slot.id];
          return (
            <div key={slot.id} className={piece ? styles.on : undefined}>
              <dt>{slot.stat}</dt>
              <dd>+{piece ? pieceBonus(piece) : 0}%</dd>
              <span>{slot.does}</span>
            </div>
          );
        })}
      </dl>

      <Armoury cells={cells} axis={axis(again)} />
    </section>
  );
}
