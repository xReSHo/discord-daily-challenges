import Link from "next/link";
import { ArrowRight, Backpack } from "lucide-react";
import { getPack, type PackEntry } from "@/lib/shop/inventory";
import { gearArt } from "@/lib/shop/gear";
import styles from "./Pack.module.css";

/**
 * What the player is carrying: the gear they have bought and not yet used.
 * One grouped read. Shown on their own record page, and linked from the shop.
 */
export async function Pack({ discordId }: { discordId: string }) {
  return <PackView pack={await getPack(discordId)} />;
}

/** The pack, drawn from entries already in hand. */
export function PackView({ pack }: { pack: PackEntry[] }) {
  const total = pack.reduce((n, e) => n + e.count, 0);

  return (
    <section id="pack" className={`${styles.pack} rise`}>
      <header className={styles.head}>
        <h2 className={styles.title}>
          <Backpack size={15} /> Your pack
          <span className={styles.count}>
            {total} item{total === 1 ? "" : "s"}
          </span>
        </h2>
        <Link href="/shop" className={styles.toShop}>
          Visit the merchant <ArrowRight size={12} />
        </Link>
      </header>

      {pack.length === 0 ? (
        <p className={styles.empty}>
          Nothing yet. The merchant sells gear for the weekly raid — what you buy is kept here until
          you use it.
        </p>
      ) : (
        <ul className={styles.grid}>
          {pack.map(({ gear, count }) => {
            const art = gearArt(gear.id);
            return (
              <li key={gear.id} className={styles.slot} tabIndex={0}>
                <span className={styles.art}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={art.src}
                    srcSet={art.srcSet}
                    sizes="96px"
                    alt=""
                    width={512}
                    height={512}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                  {count > 1 && <b className={styles.qty}>×{count}</b>}
                </span>
                <span className={styles.text}>
                  <span className={styles.name}>{gear.name}</span>
                  <span className={styles.stat}>{gear.stat}</span>
                  <span className={styles.effect}>{gear.effect}</span>
                  <span className={styles.lasts}>Lasts {gear.lasts.toLowerCase()}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
