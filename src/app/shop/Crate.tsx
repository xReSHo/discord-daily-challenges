"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Coins,
  Footprints,
  Gem,
  Hand,
  HardHat,
  PackageOpen,
  Shirt,
  Sword,
  X,
  type LucideIcon,
} from "lucide-react";
import { RARITIES, SLOTS, pieceArt, type Rarity, type SlotId } from "@/lib/equipment";
import { CRATE_NAME, emptyChance, type CrateResult, type CrateTerms } from "@/lib/crate";
import { play } from "@/lib/sfx";
import styles from "./crate.module.css";

/** Set once the pictures are in public/art (see scripts/cut-item-art.mjs). */
const ART: { closed: string | null; open: string | null } = {
  closed: "/art/crate-v1-512.webp",
  open: "/art/crate-open-v1-512.webp",
};

const SLOT_ICON: Record<SlotId, LucideIcon> = {
  sword: Sword,
  helm: HardHat,
  chest: Shirt,
  gauntlets: Hand,
  boots: Footprints,
  amulet: Gem,
};

const coins = (n: number) => n.toLocaleString("en-US");
const pct = (n: number) => `${Number(n.toFixed(2))}%`;

/** How long "Confirm" waits before the button goes back to "Open". */
const CONFIRM_MS = 4000;
/** The crate rattles at least this long before the reel starts. */
const SHAKE_MS = 900;
const SPIN_MS = 4600;
/** Tiles on the reel, and the one it stops on. */
const TILES = 46;
const STOP = 40;

type Tile = { rarity: Rarity | null; slot: SlotId };

/** A reel of tiles drawn with the crate's own odds, with the result at STOP. */
function buildReel(terms: CrateTerms, result: CrateResult): Tile[] {
  const order = RARITIES.map((r) => r.id);
  const pick = (): Rarity | null => {
    let roll = Math.random() * 100;
    for (const r of order) {
      roll -= terms.odds[r];
      if (roll < 0) return r;
    }
    return null;
  };
  const slot = () => SLOTS[Math.floor(Math.random() * SLOTS.length)].id;
  const reel: Tile[] = Array.from({ length: TILES }, () => ({ rarity: pick(), slot: slot() }));
  reel[STOP] = result.piece
    ? { rarity: result.piece.rarity, slot: result.piece.slot as SlotId }
    : { rarity: null, slot: slot() };
  return reel;
}

function CrateArt({ open, className }: { open?: boolean; className?: string }) {
  const src = open ? (ART.open ?? ART.closed) : ART.closed;
  return (
    <span className={`${styles.art} ${className ?? ""}`} aria-hidden>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={512} height={512} draggable={false} />
      ) : (
        <PackageOpen strokeWidth={1} />
      )}
    </span>
  );
}

type Phase = "idle" | "shake" | "spin" | "reveal";

/**
 * The crate on the shop's front shelf: what it costs, what can be inside and
 * how likely, and the button that opens one. An opening is played out in a
 * dialog — the crate rattles, a reel of tiles runs down to the result, and the
 * result is said plainly, coins and all.
 */
export function Crate({
  terms,
  balance,
  practice,
}: {
  terms: CrateTerms;
  /** Coins the player can spend, or null when the purse couldn't be read. */
  balance: number | null;
  practice: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const [armed, setArmed] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<CrateResult | null>(null);
  const [reel, setReel] = useState<Tile[]>([]);
  const [shift, setShift] = useState(0);
  const [opened, setOpened] = useState(0);
  // whether the opening dialog is up
  const [shown, setShown] = useState(false);

  const poor = !practice && balance != null && balance < terms.price;
  const busy = phase === "shake" || phase === "spin";
  const empty = emptyChance(terms.odds);

  // an unanswered "Confirm" quietly stands down
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => window.clearTimeout(t);
  }, [armed]);

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  async function open() {
    setArmed(false);
    setError("");
    setResult(null);
    setReel([]);
    setShift(0);
    setPhase("shake");
    if (!dialog.current?.open) dialog.current?.showModal();
    setShown(true);
    play("pick");
    const began = Date.now();

    let data: { result?: CrateResult; error?: string } = {};
    try {
      const res = await fetch("/api/crate/open", { method: "POST" });
      data = (await res.json().catch(() => ({}))) as typeof data;
      if (!res.ok || !data.result) {
        setError(data.error || "That didn't go through. Try again.");
        setPhase("idle");
        router.refresh();
        return;
      }
    } catch {
      setError("Network error. If coins were taken, the result is in your equipment.");
      setPhase("idle");
      router.refresh();
      return;
    }

    const got = data.result;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    later(
      () => {
        setResult(got);
        setReel(buildReel(terms, got));
        setOpened((n) => n + 1);
        setPhase("spin");
        const spin = calm ? 0 : SPIN_MS;
        // one frame at the start position, then let it run
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const view = windowRef.current;
            const tile = view?.querySelector<HTMLElement>("[data-tile]");
            if (view && tile) {
              const step = tile.offsetWidth + parseFloat(getComputedStyle(tile.parentElement!).columnGap || "0");
              // stop a little off-centre, as a real reel would
              const off = (Math.random() - 0.5) * tile.offsetWidth * 0.6;
              setShift(STOP * step + tile.offsetWidth / 2 - view.clientWidth / 2 + off);
            }
          }),
        );
        if (!calm) {
          // ticks that slow with the reel
          for (let i = 1; i <= 16; i++) later(() => play("tap"), spin * (1 - Math.pow(1 - i / 17, 2.6)));
        }
        later(() => {
          setPhase("reveal");
          if (got.outcome === "new") play("found");
          else if (got.outcome === "repeat") play("coin");
          else play("empty");
          router.refresh(); // the purse and the equipment both changed
        }, spin + 350);
      },
      Math.max(0, (calm ? 0 : SHAKE_MS) - (Date.now() - began)),
    );
  }

  function close() {
    if (busy) return;
    dialog.current?.close();
    setShown(false);
    setPhase("idle");
  }

  const rows = useMemo(
    () =>
      RARITIES.map((r) => {
        const back = terms.refund[r.id];
        return {
          ...r,
          chance: terms.odds[r.id],
          back,
          tone: back > terms.price ? styles.more : back < terms.price ? styles.less : styles.even,
        };
      }),
    [terms],
  );

  const net = result ? result.coins - result.price : 0;

  return (
    <section className={`${styles.crate} rise`} aria-labelledby="crate-title">
      <CrateArt className={styles.shelfArt} />

      <div className={styles.body}>
        <p className={styles.eyebrow}>Sealed relic</p>
        <h2 id="crate-title" className={styles.title}>
          {CRATE_NAME}
        </h2>
        <p className={styles.blurb}>
          One piece of equipment of any rarity — or nothing at all. What is inside is decided the moment it
          opens.
        </p>

        <div className={styles.buy}>
          <span className={styles.price}>
            <Coins size={15} /> {coins(terms.price)}
          </span>
          {poor ? (
            <span className={styles.locked}>Not enough coins</span>
          ) : armed ? (
            <button type="button" className={`${styles.button} ${styles.confirm}`} onClick={() => void open()}>
              Confirm · spend {coins(terms.price)}
            </button>
          ) : (
            <button type="button" className={styles.button} onClick={() => setArmed(true)} disabled={busy}>
              Open the crate
            </button>
          )}
        </div>
        {practice && <p className={styles.note}>Dev mode: a practice opening. No coins move and nothing is kept.</p>}
        {error && phase === "idle" && !shown && <p className={styles.error}>{error}</p>}
      </div>

      <div className={styles.inside}>
        <h3 className={styles.insideHead}>What can be inside</h3>
        <ul className={styles.odds}>
          {rows.map((r) => (
            <li key={r.id} className={styles[r.id]}>
              <i aria-hidden />
              <span>{r.name}</span>
              <b>{pct(r.chance)}</b>
              <small>{r.chance > 0 ? `1 in ${Math.round(100 / r.chance).toLocaleString("en-US")}` : "never"}</small>
              <em className={r.tone}>{coins(r.back)} if owned</em>
            </li>
          ))}
          <li className={styles.none}>
            <i aria-hidden />
            <span>Empty</span>
            <b>{pct(empty)}</b>
            <small />
            <em className={styles.less}>nothing</em>
          </li>
        </ul>
        <p className={styles.rule}>
          You never own a piece twice. If the crate holds one you already have, you are paid the coins shown
          instead — less than the crate costs for the common kinds, more only for an epic or a legendary.
        </p>
      </div>

      <dialog
        ref={dialog}
        className={styles.stage}
        aria-label={`Opening ${CRATE_NAME}`}
        onCancel={(e) => {
          if (busy) e.preventDefault(); // an opening can't be walked away from mid-roll
          else {
            setShown(false);
            setPhase("idle");
          }
        }}
        onClick={(e) => e.target === dialog.current && close()}
      >
        <div className={styles.stageInner}>
          <button type="button" className={styles.close} onClick={close} disabled={busy} aria-label="Close">
            <X size={16} />
          </button>

          {phase === "shake" && (
            <div className={styles.waiting}>
              <CrateArt className={styles.shaking} />
              <p className={styles.stageLine}>The seal is breaking…</p>
            </div>
          )}

          {(phase === "spin" || phase === "reveal") && result && (
            <>
              <CrateArt open className={styles.opened} />
              <div
                ref={windowRef}
                className={`${styles.window} ${phase === "reveal" ? styles.windowDone : ""}`}
                aria-hidden
              >
                <span className={styles.needle} />
                <ol
                  key={opened}
                  className={styles.reel}
                  style={{
                    transform: `translate3d(${-shift}px, 0, 0)`,
                    transitionDuration: shift === 0 ? "0ms" : `${SPIN_MS}ms`,
                  }}
                >
                  {reel.map((t, i) => {
                    const Icon = SLOT_ICON[t.slot];
                    return (
                      <li
                        key={i}
                        data-tile
                        className={`${styles.tile} ${t.rarity ? styles[t.rarity] : styles.blank} ${
                          phase === "reveal" && i === STOP ? styles.won : ""
                        }`}
                      >
                        {t.rarity ? <Icon strokeWidth={1.4} /> : <span>—</span>}
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className={styles.verdict} aria-live="polite">
                {phase === "spin" ? (
                  <p className={styles.stageLine}>…</p>
                ) : result.outcome === "empty" ? (
                  <div className={`${styles.result} ${styles.resultEmpty}`}>
                    <strong>Empty</strong>
                    <p>Dust and an old smell of incense. The crate held nothing.</p>
                    {!result.practice && <p className={styles.sum}>{coins(result.price)} coins spent.</p>}
                  </div>
                ) : (
                  <div className={`${styles.result} ${styles[result.piece!.rarity]}`}>
                    <span className={styles.piece}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={pieceArt(result.piece!.id).src}
                        srcSet={pieceArt(result.piece!.id).srcSet}
                        sizes="120px"
                        alt=""
                        width={160}
                        height={160}
                        draggable={false}
                      />
                    </span>
                    <small>{RARITIES.find((r) => r.id === result.piece!.rarity)?.name}</small>
                    <strong>{result.piece!.name}</strong>
                    {result.outcome === "new" ? (
                      <p>
                        New to you. It is in your equipment now.{" "}
                        <Link href="/me#equipment" className={styles.link}>
                          See it <ArrowRight size={11} />
                        </Link>
                      </p>
                    ) : (
                      <>
                        <p>
                          You already own this, so you are paid <b>{coins(result.coins)}</b> coins instead.
                        </p>
                        {!result.practice && (
                          <p className={`${styles.sum} ${net > 0 ? styles.more : net < 0 ? styles.less : ""}`}>
                            {net > 0
                              ? `${coins(net)} more than the crate cost.`
                              : net < 0
                                ? `${coins(-net)} less than the crate cost.`
                                : "Exactly what the crate cost."}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
                {result.practice && phase === "reveal" && (
                  <p className={styles.note}>Dev mode: nothing was charged or kept.</p>
                )}
              </div>
            </>
          )}

          {phase === "idle" && error && <p className={styles.error}>{error}</p>}

          {(phase === "reveal" || (phase === "idle" && error)) && (
            <div className={styles.actions}>
              <button type="button" className={styles.button} onClick={() => void open()} disabled={poor}>
                {poor ? "Not enough coins" : `Open another · ${coins(terms.price)}`}
              </button>
              <button type="button" className={styles.quiet} onClick={close}>
                Done
              </button>
            </div>
          )}
        </div>
      </dialog>
    </section>
  );
}
