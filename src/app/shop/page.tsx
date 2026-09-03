import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Clock, Coins, Hourglass, Landmark, Package, Wallet } from "lucide-react";
import { getShop, type WebsiteShopUiItem } from "@/lib/shop";
import { AppFrame } from "@/components/AppFrame";
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

export default async function ShopPage() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) redirect("/");

  const shop = await getShop(discordId);

  return (
    <AppFrame back={{ href: "/dashboard", label: "All trials" }}>
      <div className="container">
        <header className={`${styles.head} rise`}>
          <p className="eyebrow">The Emporium</p>
          <h1 className={styles.title}>Merchant&apos;s wares</h1>
          <p className={styles.sub}>
            {shop.items.length === 0
              ? "The merchant is still setting out the stall. Keep earning coin — wares are on their way."
              : "Limited offerings, bought with the coin you've banked. The payment comes off and the rank lands in Discord straight away."}
          </p>
        </header>

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
          </div>
        )}

        {shop.items.length === 0 ? (
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
          <div className={`${styles.grid} stagger`}>
            {shop.items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </AppFrame>
  );
}

function ItemCard({ item }: { item: WebsiteShopUiItem }) {
  const dimmed = item.soldOut || item.owned;
  return (
    <article
      className={`panel panel--lit ${styles.card} ${dimmed ? styles.cardSpent : ""}`}
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
