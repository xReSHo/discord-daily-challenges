import { Coins, type LucideIcon } from "lucide-react";
import styles from "./GameHeader.module.css";

export function GameHeader({
  icon: Icon,
  title,
  reward,
  date,
}: {
  icon: LucideIcon;
  title: string;
  reward: number;
  date: string;
}) {
  return (
    <header className={`${styles.head} rise`}>
      <div className={styles.left}>
        <span className={styles.iconWrap}>
          <Icon size={22} strokeWidth={1.5} />
        </span>
        <div>
          <p className="eyebrow">Daily Trial</p>
          <h1 className={styles.title}>{title}</h1>
        </div>
      </div>

      <div className={styles.meta}>
        <span className={`mono ${styles.date}`}>{date}</span>
        <span className={styles.dot} />
        <span className="rune">
          <Coins />
          {reward}
        </span>
      </div>
    </header>
  );
}
