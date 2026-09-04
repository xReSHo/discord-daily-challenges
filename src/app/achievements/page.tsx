import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatAdminTime } from "@/lib/challenge-date";
import { ACHIEVEMENTS, rewardLine } from "@/lib/achievements/catalog";
import { AppFrame } from "@/components/AppFrame";
import styles from "./achievements.module.css";

export default async function AchievementsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.discordId) redirect("/");

  const rows = await prisma.achievement.findMany({ where: { discordId: user.discordId } });
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return (
    <AppFrame back={{ href: "/dashboard", label: "All trials" }}>
      <div className="container">
        <header className={`${styles.head} rise`}>
          <p className="eyebrow">Your feats</p>
          <h1 className={styles.title}>Achievements</h1>
          <p className={styles.meta}>
            {rows.length} of {ACHIEVEMENTS.length} unlocked
          </p>
        </header>

        <div className={`${styles.grid} stagger`}>
          {ACHIEVEMENTS.map((def) => {
            const row = byKey.get(def.key);
            const Icon = def.icon;
            return (
              <article
                key={def.key}
                className={`panel ${row ? "panel--lit" : ""} ${styles.card} ${
                  row ? styles.cardUnlocked : styles.cardLocked
                }`}
              >
                <span className={`${styles.iconWrap} ${row ? "" : styles.iconLocked}`}>
                  <Icon size={26} strokeWidth={1.4} />
                </span>
                <h2 className={styles.name}>{def.name}</h2>
                <p className={styles.desc}>{def.description}</p>
                <p className={styles.reward}>{rewardLine(def.reward)}</p>
                <p className={`${styles.status} ${row ? styles.statusUnlocked : ""}`}>
                  {row ? `Unlocked ${formatAdminTime(row.unlockedAt)}` : "Locked"}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </AppFrame>
  );
}
