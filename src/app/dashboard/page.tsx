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
  Lock,
  Orbit,
  ShieldCheck,
  Swords,
  Triangle,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { getCompletedSectionsToday } from "@/lib/completions";
import { getFailedSectionsToday } from "@/lib/attempts";
import { getDisabledSections } from "@/lib/section-status";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getUserStreak } from "@/lib/streak";
import { SECTION_IDS, SECTIONS, type SectionId } from "@/lib/sections";
import { getBossState } from "@/lib/boss/game";
import { AppFrame } from "@/components/AppFrame";
import styles from "./dashboard.module.css";

function bossTimeLeft(expiresAt: string): string {
  const s = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
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
  litany: {
    icon: Orbit,
    blurb: "Recite the rite from memory. Each round adds a glyph; one slip breaks it.",
  },
  geodash: {
    icon: Triangle,
    blurb: "Pay to run the gauntlet. Pick a difficulty, hold the jump — clear it or lose the stake.",
  },
};

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const discordId = session.user.discordId;
  const [completed, failedSections, disabledSections] = discordId
    ? await Promise.all([
        getCompletedSectionsToday(discordId),
        getFailedSectionsToday(discordId),
        getDisabledSections(),
      ])
    : [
        new Set<SectionId>(),
        new Set<SectionId>(),
        new Map<SectionId, string | null>(),
      ];

  const doneCount = SECTION_IDS.filter((id) => completed.has(id)).length;
  const streak = discordId ? await getUserStreak(discordId) : null;
  const boss = await getBossState(discordId);

  return (
    <AppFrame>
      <div className="container">
        {boss.status === "active" && (
          <Link href="/boss" className={`panel panel--lit ${styles.bossBanner} rise`}>
            <Swords size={22} strokeWidth={1.5} className={styles.bossIcon} />
            <span className={styles.bossText}>
              <strong>{boss.name}</strong> stirs —{" "}
              {boss.adminOnly ? "test raid (admins only)" : "the weekly raid is live"}
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
            {streak && streak.current > 0 ? (
              <Link href="/me" className={styles.streak}>
                <Flame size={13} strokeWidth={2} />
                {streak.current}-day streak
              </Link>
            ) : (
              <span>resets at midnight</span>
            )}
          </p>
        </header>

        <div className={`${styles.grid} stagger`}>
          {SECTION_IDS.map((id) => {
            const section = SECTIONS[id];
            const meta = META[id];
            const done = completed.has(id);
            const closed = !done && disabledSections.has(id);
            const failed = !done && !closed && failedSections.has(id);

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
                  <span
                    className={`stamp ${
                      done
                        ? "stamp--done"
                        : closed
                          ? "stamp--closed"
                          : failed
                            ? "stamp--failed"
                            : "stamp--open"
                    }`}
                  >
                    {done ? (
                      <ShieldCheck />
                    ) : closed ? (
                      <Lock />
                    ) : failed ? (
                      <XCircle />
                    ) : (
                      <Flame />
                    )}
                    {done ? "Bested" : closed ? "Closed" : failed ? "Failed" : "Open"}
                  </span>
                </div>

                <h2 className={styles.cardName}>{section.label}</h2>
                <p className={styles.cardBlurb}>{meta.blurb}</p>

                <div className={styles.cardFoot}>
                  <span className="rune">
                    <Coins />
                    {id === "geodash" ? `${section.reward}+ stake` : section.reward}
                  </span>
                  <span className={styles.enter}>
                    {done ? "Review" : closed ? "Closed" : failed ? "See" : "Enter"}
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
