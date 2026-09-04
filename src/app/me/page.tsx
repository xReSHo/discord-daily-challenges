import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Award, Flame, Trophy } from "lucide-react";
import { getProfile } from "@/lib/profile";
import { MAX_GUESSES } from "@/lib/wordle/game";
import type { ScoreMetric } from "@/lib/scores";
import { AppFrame } from "@/components/AppFrame";
import styles from "./me.module.css";

function fmtBest(metric: ScoreMetric, v: number): string {
  switch (metric) {
    case "wpm":
      return `${Math.round(v)} wpm`;
    case "aimMs":
      return `${Math.round(v)} ms / target`;
    case "litanyRound":
      return `round ${Math.round(v)}`;
    case "geoPercent":
      return `${Math.round(v)}% cleared`;
  }
}

function heatLevel(count: number): string {
  if (count <= 0) return styles.lvl0;
  if (count === 1) return styles.lvl1;
  if (count === 2) return styles.lvl2;
  if (count === 3) return styles.lvl3;
  return styles.lvl4; // every trial that day
}

export default async function MePage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.discordId) redirect("/");

  const p = await getProfile(user.discordId);
  const wonPct =
    p.wordle && p.wordle.played
      ? Math.round((p.wordle.won / p.wordle.played) * 100)
      : 0;
  const distMax = p.wordle ? Math.max(1, ...p.wordle.distribution) : 1;

  return (
    <AppFrame back={{ href: "/dashboard", label: "All trials" }}>
      <div className="container">
        <header className={`${styles.head} rise`}>
          <p className="eyebrow">Your record</p>
          <h1 className={styles.title}>{user.name ?? "Nameless"}</h1>
          <Link href="/leaderboard" className={styles.ranksLink}>
            <Trophy size={13} /> See the streak leaderboard
          </Link>
        </header>

        <div className={`${styles.tiles} stagger`}>
          <div className={`panel ${styles.tile}`}>
            <span className={styles.tileNum}>
              <Flame size={18} className={styles.flame} />
              {p.streak.current}
            </span>
            <span className={styles.tileLabel}>day streak</span>
          </div>
          <div className={`panel ${styles.tile}`}>
            <span className={styles.tileNum}>{p.streak.longest}</span>
            <span className={styles.tileLabel}>longest streak</span>
          </div>
          <div className={`panel ${styles.tile}`}>
            <span className={styles.tileNum}>{p.totalTrials}</span>
            <span className={styles.tileLabel}>trials bested</span>
          </div>
          <div className={`panel ${styles.tile}`}>
            <span className={styles.tileNum}>{p.perfectDays}</span>
            <span className={styles.tileLabel}>perfect days</span>
          </div>
          <div className={`panel ${styles.tile}`}>
            <span className={styles.tileNum}>
              {p.lifetimeCoins.toLocaleString()}
            </span>
            <span className={styles.tileLabel}>coins banked here</span>
          </div>
          <div className={`panel ${styles.tile}`}>
            <span className={styles.tileNum}>{p.activeDays}</span>
            <span className={styles.tileLabel}>days active</span>
          </div>
          <Link href="/achievements" className={`panel ${styles.tile}`}>
            <span className={styles.tileNum}>
              <Award size={18} />
              {p.achievementsUnlocked}/{p.achievementsTotal}
            </span>
            <span className={styles.tileLabel}>achievements</span>
          </Link>
        </div>

        <section className={`panel panel--pad ${styles.section} rise`}>
          <h2 className={styles.h2}>Last 17 weeks</h2>
          <div className={styles.heat}>
            {p.heat.map((c) => (
              <span
                key={c.date}
                className={`${styles.cell} ${heatLevel(c.count)}`}
                title={`${c.date}: ${c.count} trial${c.count === 1 ? "" : "s"}`}
              />
            ))}
          </div>
        </section>

        <section className={`panel panel--pad ${styles.section} rise`}>
          <h2 className={styles.h2}>By game</h2>
          <div className={styles.gameRows}>
            {p.games.map((g) => (
              <div key={g.id} className={styles.gameRow}>
                <span className={styles.gameName}>{g.label}</span>
                <span className={styles.gameMeta}>
                  {g.plays} played
                  {g.best && (
                    <>
                      {" · best "}
                      <strong>{fmtBest(g.best.metric, g.best.value)}</strong>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>

        {p.wordle && (
          <section className={`panel panel--pad ${styles.section} rise`}>
            <h2 className={styles.h2}>
              Wordle — {p.wordle.won}/{p.wordle.played} solved ({wonPct}%)
            </h2>
            <div className={styles.dist}>
              {Array.from({ length: MAX_GUESSES }).map((_, i) => (
                <div key={i} className={styles.distRow}>
                  <span className={styles.distN}>{i + 1}</span>
                  <span
                    className={styles.distBar}
                    style={{
                      width: `${(p.wordle!.distribution[i] / distMax) * 100}%`,
                    }}
                  />
                  <span className={styles.distC}>{p.wordle!.distribution[i]}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppFrame>
  );
}
