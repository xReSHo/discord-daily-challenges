import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Flame } from "lucide-react";
import { getStreakLeaderboard } from "@/lib/leaderboard";
import { AppFrame } from "@/components/AppFrame";
import styles from "./leaderboard.module.css";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) redirect("/");

  const rows = await getStreakLeaderboard(discordId);
  const youListed = rows.some((r) => r.you);

  return (
    <AppFrame back={{ href: "/dashboard", label: "All trials" }}>
      <div className="container">
        <header className={`${styles.head} rise`}>
          <p className="eyebrow">The faithful</p>
          <h1 className={styles.title}>Streak leaderboard</h1>
          <p className={styles.sub}>
            Ranked by the current run of consecutive days with a trial bested.
            Last 90 days.
          </p>
        </header>

        {rows.length === 0 ? (
          <p className={styles.empty}>
            No streaks yet. <Link href="/dashboard">Best a trial</Link> to start
            one.
          </p>
        ) : (
          <ol className={`${styles.list} stagger`}>
            {rows.map((r) => (
              <li
                key={r.discordId}
                className={`panel ${styles.row} ${r.you ? styles.you : ""}`}
              >
                <span className={styles.rank}>{r.rank}</span>
                {r.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image} alt="" className={styles.avatar} />
                ) : (
                  <span className={styles.avatar} aria-hidden />
                )}
                <span className={styles.name}>
                  {r.name}
                  {r.you && <span className={styles.tag}>you</span>}
                </span>
                <span className={styles.streak}>
                  <Flame size={14} className={styles.flame} />
                  {r.current}
                </span>
                <span className={styles.extra}>
                  best {r.longest} · {r.trials} trials
                </span>
              </li>
            ))}
          </ol>
        )}

        {!youListed && (
          <p className={styles.empty}>
            You&apos;re not on the board yet — keep a daily streak going to
            climb on.
          </p>
        )}
      </div>
    </AppFrame>
  );
}
