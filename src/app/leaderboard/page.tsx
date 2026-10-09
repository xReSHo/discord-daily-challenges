import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Award, CalendarCheck, Crown, Flame, Sparkles, Swords, Trophy } from "lucide-react";
import { getStreakLeaderboard, type LeaderRow } from "@/lib/leaderboard";
import { SECTIONS, isSectionId } from "@/lib/sections";
import { AppFrame } from "@/components/AppFrame";
import { PageHero } from "@/components/PageHero";
import { Face } from "./Face";
import styles from "./leaderboard.module.css";

export const dynamic = "force-dynamic";

/** What the three seats at the head of the board are called. */
const SEATS = ["The Unbroken", "The Steadfast", "The Devoted"];

function Avatar({ row, className }: { row: LeaderRow; className: string }) {
  return <Face image={row.image} name={row.name} className={className} />;
}

/** The five figures anyone may see of a player, as label and number. */
function figures(row: LeaderRow) {
  return [
    { icon: Trophy, label: "Best", title: "Longest streak", value: row.longest },
    { icon: Swords, label: "Trials", title: "Trials bested", value: row.trials },
    { icon: Sparkles, label: "Perfect", title: "Days with every trial bested", value: row.perfect },
    { icon: CalendarCheck, label: "Active", title: "Days with at least one trial bested", value: row.days },
    { icon: Award, label: "Feats", title: "Achievements unlocked", value: row.feats },
  ];
}

/** A player below the three seats: one card, everything on its face. */
function Card({ row }: { row: LeaderRow }) {
  return (
    <li className={`panel ${styles.card} ${row.you ? styles.mine : ""}`}>
      <span className={styles.cardRank} aria-label={`Rank ${row.rank}`}>
        {String(row.rank).padStart(2, "0")}
      </span>
      <Avatar row={row} className={styles.avatar} />
      <span className={styles.name}>
        <span className={styles.nameText}>{row.name}</span>
        {row.you && <span className={styles.tag}>you</span>}
      </span>
      <span className={styles.cardStreak} title="Current streak">
        <Flame size={15} className={styles.flame} />
        <b>{row.current}</b>
        <small>{row.current === 1 ? "day" : "days"}</small>
      </span>
      <dl className={styles.strip}>
        {figures(row).map((f) => (
          <div key={f.label} title={f.title}>
            <dt>
              <f.icon size={11} /> {f.label}
            </dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

/** What anyone may see of a player: a summary of the last 90 days, no more. */
function Deeds({ row }: { row: LeaderRow }) {
  const games = Object.entries(row.games)
    .filter(([id, n]) => n > 0 && isSectionId(id))
    .sort((a, b) => b[1] - a[1]);
  return (
    <>
      <dl className={styles.deeds}>
        {figures(row).map((f) => (
          <div key={f.label} title={f.title}>
            <dt>
              <f.icon size={12} /> {f.label}
            </dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {games.length > 0 && (
        <p className={styles.games}>
          {games.map(([id, n]) => (
            <span key={id}>
              {SECTIONS[id as keyof typeof SECTIONS].label} <b>{n}</b>
            </span>
          ))}
        </p>
      )}
    </>
  );
}

function Seat({ row, place }: { row: LeaderRow | undefined; place: number }) {
  const num = String(place).padStart(2, "0");
  if (!row) {
    return (
      <li className={`${styles.seat} ${styles[`seat${place}`]} ${styles.vacant}`}>
        <span className={styles.numeral} aria-hidden="true">
          {num}
        </span>
        <span className={styles.medal}>
          <span className={styles.orbit} aria-hidden="true" />
          <span className={`${styles.face} ${styles.faceEmpty}`} aria-hidden="true" />
        </span>
        <p className={styles.seatTitle}>{SEATS[place - 1]}</p>
        <h2 className={styles.seatName}>The seat stands empty</h2>
        <p className={styles.vacantText}>Best a trial to claim it.</p>
      </li>
    );
  }
  return (
    <li
      className={`panel panel--lit ornate ${styles.seat} ${styles[`seat${place}`]} ${row.you ? styles.mine : ""}`}
    >
      <span className={styles.numeral} aria-hidden="true">
        {num}
      </span>
      <span className={styles.medal}>
        <span className={styles.orbit} aria-hidden="true" />
        {place === 1 && <Crown size={20} strokeWidth={1.5} className={styles.crown} aria-hidden="true" />}
        <Avatar row={row} className={styles.face} />
      </span>
      <p className={styles.seatTitle}>{SEATS[place - 1]}</p>
      <h2 className={styles.seatName}>
        {row.name}
        {row.you && <span className={styles.tag}>you</span>}
      </h2>
      <p className={styles.streak}>
        <Flame size={22} className={styles.flame} />
        <span className={styles.streakNum}>{row.current}</span>
        <span className={styles.streakLabel}>day streak</span>
      </p>
      <Deeds row={row} />
    </li>
  );
}

export default async function LeaderboardPage() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) redirect("/");

  const rows = await getStreakLeaderboard(discordId);
  const rest = rows.slice(3);
  const you = rows.find((r) => r.you);

  return (
    <AppFrame flow="/leaderboard">
      <PageHero
        art="leaderboard"
        eyebrow="The faithful"
        title="Streak leaderboard"
        back={{ href: "/dashboard", label: "All trials" }}
        aside={
          <Link href="/me" className={styles.standing}>
            <span className={styles.standingNum}>{you ? `#${you.rank}` : "—"}</span>
            <span className={styles.standingLabel}>
              {you ? "your standing" : "not yet ranked"}
              <small>see your record</small>
            </span>
          </Link>
        }
      >
        <p className={styles.sub}>
          Ranked by the current run of days with every trial bested, then by trials bested. Last 90
          days.
        </p>
      </PageHero>

      <div className="container">
        {/* the three seats at the head of the board */}
        <ol className={`${styles.podium} stagger`}>
          <Seat row={rows[0]} place={1} />
          <Seat row={rows[1]} place={2} />
          <Seat row={rows[2]} place={3} />
        </ol>

        {rest.length > 0 && (
          <>
            <h2 className={styles.heading}>
              <span>The rest of the faithful</span>
            </h2>
            <ol className={`${styles.list} stagger`} start={4}>
              {rest.map((r) => (
                <Card key={r.discordId} row={r} />
              ))}
            </ol>
          </>
        )}
      </div>
    </AppFrame>
  );
}
