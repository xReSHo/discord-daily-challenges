import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Coins,
  Crosshair,
  Flame,
  Grid3x3,
  Keyboard,
  ShieldCheck,
  Swords,
  type LucideIcon,
} from "lucide-react";
import { getCompletedSectionsToday } from "@/lib/completions";
import { getChallengeDateString } from "@/lib/challenge-date";
import { SECTION_IDS, SECTIONS, type SectionId } from "@/lib/sections";
import { getBossWindow } from "@/lib/boss/window";
import { BOSS_NAME } from "@/lib/boss/config";
import { AppFrame } from "@/components/AppFrame";
import styles from "./dashboard.module.css";

function bossTimeLeft(expiresAt: Date): string {
  const s = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const META: Record<
  SectionId,
  { icon: LucideIcon; blurb: string }
> = {
  wordle: {
    icon: Grid3x3,
    blurb: "Six guesses to find the word. The same word for every challenger that day.",
  },
  typing: {
    icon: Keyboard,
    blurb: "Type the passage cleanly and fast. Three mistakes and the run is lost.",
  },
  aim: {
    icon: Crosshair,
    blurb: "Strike all twenty marks before the timer burns down to nothing.",
  },
};

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const discordId = session.user.discordId;
  const completed = discordId
    ? await getCompletedSectionsToday(discordId)
    : new Set<SectionId>();

  const doneCount = SECTION_IDS.filter((id) => completed.has(id)).length;
  const boss = getBossWindow();

  return (
    <AppFrame>
      <div className="container">
        {boss.status === "active" && (
          <Link href="/boss" className={`panel panel--lit ${styles.bossBanner} rise`}>
            <Swords size={22} strokeWidth={1.5} className={styles.bossIcon} />
            <span className={styles.bossText}>
              <strong>{BOSS_NAME}</strong> stirs — the weekly raid is live
            </span>
            <span className={styles.bossMeta}>
              {bossTimeLeft(boss.expiresAt)} left
              <ArrowRight size={14} />
            </span>
          </Link>
        )}

        <header className={`${styles.head} rise`}>
          <p className="eyebrow">The Trials</p>
          <h1 className={styles.title}>Today&apos;s grace</h1>
          <p className={styles.meta}>
            <span className="mono">{getChallengeDateString()}</span>
            <span className={styles.sep} />
            <span>
              {doneCount} of {SECTION_IDS.length} bested
            </span>
            <span className={styles.sep} />
            <span>resets at midnight</span>
          </p>
        </header>

        <div className={`${styles.grid} stagger`}>
          {SECTION_IDS.map((id) => {
            const section = SECTIONS[id];
            const meta = META[id];
            const done = completed.has(id);

            return (
              <Link
                key={id}
                href={section.href}
                className={`panel panel--lit ${styles.card}`}
              >
                <div className={styles.cardTop}>
                  <meta.icon
                    size={24}
                    strokeWidth={1.4}
                    className={styles.cardIcon}
                  />
                  <span className={`stamp ${done ? "stamp--done" : "stamp--open"}`}>
                    {done ? <ShieldCheck /> : <Flame />}
                    {done ? "Bested" : "Open"}
                  </span>
                </div>

                <h2 className={styles.cardName}>{section.label}</h2>
                <p className={styles.cardBlurb}>{meta.blurb}</p>

                <div className={styles.cardFoot}>
                  <span className="rune">
                    <Coins />
                    {section.reward}
                  </span>
                  <span className={styles.enter}>
                    {done ? "Review" : "Enter"}
                    <ArrowRight size={14} />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </AppFrame>
  );
}
