import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatAdminTime } from "@/lib/challenge-date";
import { AchievementIcon, rewardLine } from "@/lib/achievements/catalog";
import { getAllAchievementDefs } from "@/lib/achievements/store";
import { AppFrame } from "@/components/AppFrame";
import { PageHero } from "@/components/PageHero";
import styles from "./achievements.module.css";

export default async function AchievementsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.discordId) redirect("/");

  const [rows, allDefs] = await Promise.all([
    prisma.achievement.findMany({ where: { discordId: user.discordId } }),
    getAllAchievementDefs(),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  // Live achievements, plus any retired one this player already earned.
  const defs = allDefs.filter((d) => d.enabled || byKey.has(d.key));
  const unlocked = defs.filter((d) => byKey.has(d.key)).length;

  return (
    <AppFrame flow="/achievements">
      <PageHero
        art="achievements"
        eyebrow="Your feats"
        title="Achievements"
        back={{ href: "/dashboard", label: "All trials" }}
        aside={
          <div className={styles.tally}>
            <span className={styles.tallyNum}>
              {unlocked}
              <small>/{defs.length}</small>
            </span>
            <span className={styles.tallyLabel}>unlocked</span>
            <span className={styles.tallyBar} aria-hidden="true">
              <span style={{ width: `${defs.length ? (unlocked / defs.length) * 100 : 0}%` }} />
            </span>
          </div>
        }
      />

      <div className="container">

        <div className={`${styles.grid} stagger`}>
          {defs.map((def) => {
            const row = byKey.get(def.key);
            return (
              <article
                key={def.key}
                className={`panel ${row ? "panel--lit ornate ornate--live" : ""} ${styles.card} ${
                  row ? styles.cardUnlocked : styles.cardLocked
                }`}
              >
                <span className={`${styles.iconWrap} ${row ? "" : styles.iconLocked}`}>
                  <AchievementIcon name={def.icon} size={26} strokeWidth={1.4} />
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
