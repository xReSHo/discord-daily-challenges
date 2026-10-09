import { Coins, type LucideIcon } from "lucide-react";
import type { ArtKey } from "@/lib/art";
import { PageHero } from "./PageHero";
import { Spoils } from "./Spoils";
import styles from "./GameHeader.module.css";

/** The short banner above a game: its name over its artwork, with the day and
 *  the reward opposite. */
export function GameHeader({
  icon: Icon,
  title,
  reward,
  date,
  art = "trials",
}: {
  icon: LucideIcon;
  title: string;
  reward: number;
  date: string;
  art?: ArtKey;
}) {
  return (
    <PageHero
      compact
      art={art}
      eyebrow="Daily Trial"
      title={
        <span className={styles.title}>
          <span className={styles.iconWrap}>
            <Icon size={20} strokeWidth={1.5} />
          </span>
          {title}
        </span>
      }
      back={{ href: "/dashboard", label: "All trials" }}
      aside={
        <div className={styles.meta}>
          <span className={`mono ${styles.date}`}>{date}</span>
          <span className={styles.dot} />
          <span className="rune">
            <Coins />
            {reward.toLocaleString()}
          </span>
          <Spoils source="trial" />
        </div>
      }
    />
  );
}
