import Link from "next/link";
import {
  ArrowRight,
  Award,
  CalendarCheck,
  Coins,
  Crosshair,
  Flame,
  FlameKindling,
  Grid3x3,
  Keyboard,
  Orbit,
  Sparkles,
  Swords,
  Triangle,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { getProfile } from "@/lib/profile";
import type { ScoreMetric } from "@/lib/scores";
import { SECTIONS, type SectionId } from "@/lib/sections";
import type { ArtKey } from "@/lib/art";
import { ArtImage } from "./ArtImage";
import { InView } from "./InView";
import { RecordCalendar } from "./RecordCalendar";
import styles from "./YourRecord.module.css";

const GAME: Record<SectionId, { icon: LucideIcon; art: ArtKey }> = {
  wordle: { icon: Grid3x3, art: "wordle" },
  typing: { icon: Keyboard, art: "trials" },
  aim: { icon: Crosshair, art: "aim" },
  litany: { icon: Orbit, art: "trials" },
  geodash: { icon: Triangle, art: "trials" },
  braziers: { icon: FlameKindling, art: "braziers" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
    case "brazierTouches":
      return `${Math.round(v)} touches`;
  }
}

/** "2026-10-01" → "1 Oct" */
function fmtDay(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** The ring's circumference (r = 54). */
const RING = 2 * Math.PI * 54;

function Tile({
  icon: Icon,
  value,
  label,
  hint,
}: {
  icon: LucideIcon;
  value: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <div className={`panel ${styles.tile}`}>
      <Icon size={16} strokeWidth={1.5} className={styles.tileIcon} />
      <span className={styles.tileNum}>{value}</span>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileHint}>{hint}</span>
    </div>
  );
}

/**
 * The signed-in player's own record in full: the streak, the totals, the last
 * 17 weeks day by day, the Wordle guess spread and each game. Only ever shown
 * to that player — what others can see of them is the short summary on the
 * leaderboard.
 */
export async function YourRecord({ discordId }: { discordId: string }) {
  const p = await getProfile(discordId);
  const { current, longest } = p.streak;
  const fill = longest > 0 ? Math.min(1, current / longest) : 0;
  const streakNote =
    current <= 0
      ? "Best every trial today to light the flame."
      : current >= longest
        ? "This is your longest run yet."
        : `${longest - current} more ${longest - current === 1 ? "day" : "days"} to match your best.`;

  const heatTrials = p.heat.reduce((n, c) => n + c.count, 0);
  const heatDays = p.heat.filter((c) => c.count > 0).length;

  const w = p.wordle;
  const lost = w ? w.played - w.won : 0;
  const distMax = w ? Math.max(1, lost, ...w.distribution) : 1;
  const mode = w ? Math.max(...w.distribution) : 0;
  const guessSum = w ? w.distribution.reduce((n, c, i) => n + c * (i + 1), 0) : 0;
  const featPct = p.achievementsTotal ? (p.achievementsUnlocked / p.achievementsTotal) * 100 : 0;

  return (
    <div className={styles.record}>
      {/* the streak, and the totals beside it */}
      <div className={styles.top}>
        <InView className={`panel panel--lit ornate ${styles.streak}`}>
          <div className={styles.ring}>
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle cx="60" cy="60" r="54" className={styles.ringTrack} />
              <circle
                cx="60"
                cy="60"
                r="54"
                className={styles.ringFill}
                style={{ "--len": RING, "--gap": RING * (1 - fill) } as React.CSSProperties}
              />
            </svg>
            <span className={styles.ringOrbit} aria-hidden="true" />
            <div className={styles.ringCore}>
              <Flame size={20} className={current > 0 ? styles.flameLit : styles.flameOut} />
              <span className={styles.ringNum}>{current}</span>
              <span className={styles.ringLabel}>day streak</span>
            </div>
          </div>
          <p className={styles.streakNote}>{streakNote}</p>
          <p className={styles.streakBest}>
            <Trophy size={12} /> longest <b>{longest}</b>
          </p>
        </InView>

        <div className={`${styles.tiles} stagger`}>
          <Tile icon={Swords} value={p.totalTrials} label="trials bested" hint="Every trial cleared, all time" />
          <Tile icon={Sparkles} value={p.perfectDays} label="perfect days" hint="Days with every trial bested" />
          <Tile icon={CalendarCheck} value={p.activeDays} label="days active" hint="Days with at least one trial" />
          <Tile icon={Trophy} value={longest} label="longest streak" hint="Your best run of perfect days" />
          <Tile
            icon={Coins}
            value={p.lifetimeCoins.toLocaleString("en-US")}
            label="coins banked"
            hint="Earned from trials on this site"
          />
          <Link href="/achievements" className={`panel ${styles.tile} ${styles.tileLink}`}>
            <Award size={16} strokeWidth={1.5} className={styles.tileIcon} />
            <span className={styles.tileNum}>
              {p.achievementsUnlocked}
              <small>/{p.achievementsTotal}</small>
            </span>
            <span className={styles.tileLabel}>achievements</span>
            <span className={styles.tileBar} aria-hidden="true">
              <span style={{ width: `${featPct}%` }} />
            </span>
            <span className={styles.tileHint}>
              See your feats <ArrowRight size={11} />
            </span>
          </Link>
        </div>
      </div>

      {/* the calendar and the Wordle spread */}
      <div className={w ? styles.split : undefined}>
        <section className={`panel panel--pad ${styles.block}`}>
          <header className={styles.blockHead}>
            <h2 className={styles.h2}>Last 17 weeks</h2>
            <p className={styles.blockMeta}>
              <b>{heatTrials}</b> trials on <b>{heatDays}</b> days
            </p>
          </header>
          <RecordCalendar heat={p.heat} />
        </section>

        {w && (
          <section className={`panel panel--pad ${styles.block}`}>
            <header className={styles.blockHead}>
              <h2 className={styles.h2}>Wordle</h2>
              <p className={styles.blockMeta}>
                <b>{w.won}</b>/{w.played} solved · <b>{w.played ? Math.round((w.won / w.played) * 100) : 0}%</b>
                {w.won > 0 && (
                  <>
                    {" · avg "}
                    <b>{(guessSum / w.won).toFixed(1)}</b>
                  </>
                )}
              </p>
            </header>
            <InView className={styles.dist}>
              {w.distribution.map((n, i) => (
                <div key={i} className={`${styles.distRow} ${n > 0 && n === mode ? styles.distTop : ""}`}>
                  <span className={styles.distN}>{i + 1}</span>
                  <span className={styles.distTrack}>
                    <span
                      className={styles.distBar}
                      style={{ width: `${(n / distMax) * 100}%`, "--i": i } as React.CSSProperties}
                    />
                  </span>
                  <span className={styles.distC}>{n}</span>
                </div>
              ))}
              <div className={`${styles.distRow} ${styles.distLost}`} title="Not solved">
                <span className={styles.distN}>✕</span>
                <span className={styles.distTrack}>
                  <span
                    className={styles.distBar}
                    style={
                      { width: `${(lost / distMax) * 100}%`, "--i": w.distribution.length } as React.CSSProperties
                    }
                  />
                </span>
                <span className={styles.distC}>{lost}</span>
              </div>
            </InView>
          </section>
        )}
      </div>

      {/* each game */}
      <h2 className={styles.heading}>
        <span>By game</span>
      </h2>
      <ul className={`${styles.games} stagger`}>
        {p.games.map((g) => {
          const { icon: Icon, art } = GAME[g.id];
          const body = (
            <>
              <span className={styles.gameArt} aria-hidden="true">
                <ArtImage art={art} sizes="(min-width: 700px) 320px, 70vw" />
              </span>
              <span className={styles.gameTop}>
                <Icon size={18} strokeWidth={1.4} className={styles.gameIcon} />
                {g.hidden && <span className={styles.sealed}>sealed</span>}
              </span>
              <span className={styles.gameName}>{g.label}</span>
              <span className={styles.gamePlays}>
                <b>{g.plays}</b> bested
              </span>
              <span className={styles.gameLine}>
                <span>best</span>
                <b>{g.best ? fmtBest(g.best.metric, g.best.value) : "—"}</b>
              </span>
              <span className={styles.gameLine}>
                <span>last</span>
                <b>{g.lastPlayed ? fmtDay(g.lastPlayed) : "—"}</b>
              </span>
            </>
          );
          return (
            <li key={g.id}>
              {g.hidden ? (
                <div className={`panel ${styles.game} ${styles.gameSealed}`}>{body}</div>
              ) : (
                <Link href={SECTIONS[g.id].href} className={`panel ${styles.game}`}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
