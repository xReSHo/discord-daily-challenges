import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Backpack,
  Boxes,
  Clock,
  Coins,
  Hourglass,
  Landmark,
  Lock,
  Package,
  Skull,
  Timer,
  Wallet,
} from "lucide-react";
import { getShop, type GearUiItem, type WebsiteShopUiItem } from "@/lib/shop";
import { GEAR_CATEGORIES, GEAR_ORDER, apartPrice, gearArt, getGear } from "@/lib/shop/gear";
import { GearBuy } from "./GearBuy";
import { Crate } from "./Crate";
import { getCrateSettings } from "@/lib/site-settings";
import { isDevMode } from "@/lib/dev-mode";
import { Wares, type WaresTab } from "./Wares";
import { AppFrame } from "@/components/AppFrame";
import { PageHero } from "@/components/PageHero";
import { BuyButton } from "./BuyButton";
import styles from "./shop.module.css";

export const dynamic = "force-dynamic";

function coins(n: number): string {
  return n.toLocaleString();
}

function endsLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { show } = await searchParams;
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) redirect("/");

  const [shop, crate, practice] = await Promise.all([
    getShop(discordId),
    getCrateSettings(),
    isDevMode(discordId),
  ]);
  const nothing = shop.items.length === 0 && shop.gear.length === 0;
  const carried = shop.gear.reduce((n, g) => n + (g.contains ? 0 : g.carrying), 0);
  const categories = GEAR_ORDER.filter((cat) => shop.gear.some((g) => g.category === cat));
  const tabs: WaresTab[] = categories.map((cat) => {
    const on = shop.gear.filter((g) => g.category === cat);
    return {
      id: cat,
      label: GEAR_CATEGORIES[cat].short,
      count: on.length,
      affordable: on.filter((g) => g.affordable).length,
    };
  });
  if (shop.items.length > 0) {
    tabs.push({
      id: "rank",
      label: "Ranks",
      count: shop.items.length,
      affordable: shop.items.filter((i) => i.affordable).length,
    });
  }

  return (
    <AppFrame flow="/shop">
      <PageHero
        art="shop"
        eyebrow="The Emporium"
        title="Merchant&apos;s wares"
        back={{ href: "/dashboard", label: "All trials" }}
      >
        <p className={styles.sub}>
          {shop.closed
            ? "The merchant has shuttered the stall for now."
            : nothing
            ? "The merchant is still setting out the stall. Keep earning coin — wares are on their way."
            : "Gear for the raid and charms for the trials, bought with the coin you've earned. What you buy goes straight into your pack."}
        </p>
      </PageHero>

      <div className="container">
        {shop.balance && (
          <div className={`${styles.purse} rise`}>
            <span className={styles.purseItem}>
              <Wallet size={15} />
              <span className={styles.purseNum}>{coins(shop.balance.cash)}</span>
              <span className={styles.purseLabel}>on hand</span>
            </span>
            <span className={styles.purseSep} aria-hidden />
            <span className={styles.purseItem}>
              <Landmark size={15} />
              <span className={styles.purseNum}>{coins(shop.balance.bank)}</span>
              <span className={styles.purseLabel}>banked</span>
            </span>
            <span className={styles.purseSep} aria-hidden />
            <span className={`${styles.purseItem} ${styles.purseTotal}`}>
              <Coins size={15} />
              <span className={styles.purseNum}>{coins(shop.balance.total)}</span>
              <span className={styles.purseLabel}>to spend</span>
            </span>
            <Link href="/me#pack" className={styles.packLink}>
              <Backpack size={14} />
              Your pack
              <b>{carried}</b>
              <ArrowRight size={12} />
            </Link>
          </div>
        )}

        {!shop.closed && crate.open && (
          <Crate
            terms={{ price: crate.price, odds: crate.odds, refund: crate.refund }}
            balance={shop.balance?.total ?? null}
            practice={practice}
          />
        )}

        {shop.closed ? (
          <div className={`${styles.soon} rise`}>
            <span className={styles.soonMark} aria-hidden>
              <Lock size={22} strokeWidth={1.4} />
            </span>
            <h2 className={styles.soonTitle}>The shop is closed</h2>
            <p className={styles.soonText}>
              {shop.closedNote ??
                "Nothing can be bought right now. Your coin is safe — check back soon."}
            </p>
          </div>
        ) : nothing ? (
          <div className={`${styles.soon} rise`}>
            <span className={styles.soonMark} aria-hidden>
              <Hourglass size={22} strokeWidth={1.4} />
            </span>
            <h2 className={styles.soonTitle}>Wares coming soon</h2>
            <p className={styles.soonText}>
              There&apos;s nothing on the shelves just yet. New items and ranks
              will show up here — bank your coin so you&apos;re ready.
            </p>
          </div>
        ) : (
          <Wares tabs={tabs} initial={show ?? "all"}>
            {categories.map((cat) => (
              <section key={cat} className={styles.shelf} data-cat={cat}>
                <header className={styles.shelfHead}>
                  <h2 className={styles.shelfTitle}>{GEAR_CATEGORIES[cat].title}</h2>
                  <p className={styles.shelfBlurb}>{GEAR_CATEGORIES[cat].blurb}</p>
                </header>
                <div className={`${styles.gearGrid} stagger`}>
                  {shop.gear
                    .filter((g) => g.category === cat)
                    .map((g) => (
                      <GearCard key={g.id} gear={g} />
                    ))}
                </div>
              </section>
            ))}

            {shop.items.length > 0 && (
              <section className={styles.shelf} data-cat="rank">
                <header className={styles.shelfHead}>
                  <h2 className={styles.shelfTitle}>Ranks</h2>
                  <p className={styles.shelfBlurb}>
                    Roles for the Discord server. The rank lands the moment you pay.
                  </p>
                </header>
                <div className={`${styles.grid} stagger`}>
                  {shop.items.map((item) => (
                    <ItemCard key={item.id} item={item} />
                  ))}
                </div>
              </section>
            )}
          </Wares>
        )}
      </div>
    </AppFrame>
  );
}

/**
 * One piece of gear on the shelf. Top to bottom it answers, in order: what is
 * it, what does it do, how long for, how many are there, and what does it cost.
 */
function GearCard({ gear }: { gear: GearUiItem }) {
  const art = gearArt(gear.id);
  const apart = apartPrice(gear);
  const scarce = gear.left != null;
  const weekly = gear.restock === "weekly";
  return (
    <article
      className={`${styles.gear} ${gear.state === "soldOut" ? styles.gearSpent : ""}`}
      data-state={gear.state}
      data-afford={gear.affordable ? "" : undefined}
    >
      <div className={styles.gearArt}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={art.src}
          srcSet={art.srcSet}
          sizes="(max-width: 620px) 40vw, 200px"
          alt=""
          width={512}
          height={512}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
        {gear.boss && (
          <span className={`${styles.tag} ${styles.gearBoss}`}>
            <Skull size={10} /> {gear.boss} <i>only</i>
          </span>
        )}
        <span className={styles.gearTags}>
          {gear.preview && <span className={`${styles.tag} ${styles.tagTime}`}>Admin preview</span>}
          {scarce && (
            <span className={`${styles.tag} ${gear.left === 0 ? "" : styles.tagScarce}`}>
              {gear.left === 0 ? "Sold out" : weekly ? `${gear.left} left this week` : `${gear.left} left`}
            </span>
          )}
          {gear.carrying > 0 && !gear.contains && (
            <span className={`${styles.tag} ${styles.tagHeld}`}>In your pack</span>
          )}
        </span>
      </div>

      <div className={styles.gearBody}>
        <h3 className={styles.gearName}>{gear.name}</h3>
        <p className={styles.gearStat}>{gear.stat}</p>
        <p className={styles.gearEffect}>{gear.effect}</p>

        {gear.contains ? (
          <ul className={styles.gearHolds}>
            {gear.contains.map((id) => (
              <li key={id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/art/items/${id}-v1-160.webp`} alt="" width={160} height={160} loading="lazy" />
                {getGear(id)?.name}
              </li>
            ))}
          </ul>
        ) : (
          <dl className={styles.gearFacts}>
            <div>
              <dt>
                <Timer size={11} /> Lasts
              </dt>
              <dd>{gear.lasts}</dd>
            </div>
            <div>
              <dt>
                <Backpack size={11} /> Carry
              </dt>
              <dd>
                {gear.carrying} of {gear.carry}
              </dd>
            </div>
            {gear.limit && gear.left == null ? (
              <div>
                <dt>
                  <Clock size={11} /> Limit
                </dt>
                <dd>
                  {gear.limit.n} a {gear.limit.per}
                </dd>
              </div>
            ) : (
              <div>
                <dt>
                  <Boxes size={11} /> {weekly ? "This week" : "Stock"}
                </dt>
                <dd>{gear.left == null ? "Unlimited" : `${gear.left} of ${gear.stock}`}</dd>
              </div>
            )}
          </dl>
        )}

        <div className={styles.gearFoot}>
          <p className={styles.gearPrice}>
            <Coins size={14} />
            <b>{coins(gear.price)}</b>
            {apart != null && apart > gear.price && <s>{coins(apart)}</s>}
          </p>
          <GearBuy id={gear.id} name={gear.name} price={gear.price} state={gear.state} />
        </div>
      </div>
    </article>
  );
}

function ItemCard({ item }: { item: WebsiteShopUiItem }) {
  const dimmed = item.soldOut || item.owned;
  return (
    <article
      className={`panel panel--lit ornate ornate--live ${styles.card} ${dimmed ? styles.cardSpent : ""}`}
      data-afford={item.affordable ? "" : undefined}
    >
      <div className={styles.cardTop}>
        <span className={styles.badge} aria-hidden>
          {item.emoji ?? <Package size={18} strokeWidth={1.4} />}
        </span>
        <span className={styles.tags}>
          {item.temporary && <span className={styles.tag}>Temporary</span>}
          {item.endsAt && (
            <span className={`${styles.tag} ${styles.tagTime}`}>
              <Clock size={10} /> ends {endsLabel(item.endsAt)}
            </span>
          )}
        </span>
      </div>

      <h3 className={styles.name}>{item.name}</h3>
      {item.description && <p className={styles.desc}>{item.description}</p>}

      <div className={styles.foot}>
        <BuyButton item={item} />
      </div>
    </article>
  );
}
