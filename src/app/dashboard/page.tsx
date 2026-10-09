import { cache, Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Coins,
  Crosshair,
  Flame,
  FlameKindling,
  Grid3x3,
  Hourglass,
  Keyboard,
  Lock,
  Orbit,
  ShieldCheck,
  Swords,
  Triangle,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { getTodayOutcomes, timeToReset, type TrialOutcome } from "@/lib/today";
import type { ScoreMetric } from "@/lib/scores";
import {
  getDisabledSections,
  getSectionRewards,
  getVisibleSectionIds,
} from "@/lib/section-status";
import { formatChallengeClock, getChallengeDateString } from "@/lib/challenge-date";
import { getUserStreak } from "@/lib/streak";
import { SECTIONS, type SectionId } from "@/lib/sections";
import { getBossState } from "@/lib/boss/game";
import { getGeodashEconomy } from "@/lib/site-settings";
import { AppFrame } from "@/components/AppFrame";
import { ArtImage } from "@/components/ArtImage";
import { PageHero } from "@/components/PageHero";
import { ENTER_CLIPS, type ArtKey } from "@/lib/art";
import { BossCountdown } from "./BossCountdown";
import { TrialGate } from "./TrialGate";
import styles from "./dashboard.module.css";

function bossTimeLeft(expiresAt: string): string {
  const s = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** The banner's countdown: to the end of a raid under way, else to the next
 *  one's start (this boss's own spawn if that is still ahead). */
function raidCountdown(boss: { status: string; spawnsAt: string; expiresAt: string; nextSpawnsAt: string }) {
  const now = Date.now();
  const live = boss.status === "active";
  const target = live
    ? boss.expiresAt
    : boss.status === "upcoming" && new Date(boss.spawnsAt).getTime() > now
      ? boss.spawnsAt
      : boss.nextSpawnsAt;
  return { now, live, target };
}

const META: Record<
  SectionId,
  { icon: LucideIcon; blurb: string; art: ArtKey }
> = {
  wordle: {
    icon: Grid3x3,
    art: "wordle",
    blurb: "Six guesses to find the word. The same word for every challenger that day.",
  },
  typing: {
    icon: Keyboard,
    art: "trials",
    blurb: "Type the passage cleanly and fast. Three mistakes and the run is lost.",
  },
  aim: {
    icon: Crosshair,
    art: "aim",
    blurb: "Strike the marks as they appear. Some are small, some drift — five misses and the run is lost.",
  },
  litany: {
    icon: Orbit,
    art: "trials",
    blurb: "Recite the rite from memory. Each round adds a glyph; one slip breaks it.",
  },
  geodash: {
    icon: Triangle,
    art: "trials",
    blurb: "Pay to run the gauntlet. Pick a difficulty, hold the jump — clear it or lose the stake.",
  },
  braziers: {
    icon: FlameKindling,
    art: "braziers",
    blurb: "Light every brazier in the hall. Each touch turns its neighbours too — and the touches are counted.",
  },
};

function fmtScore(metric: ScoreMetric, v: number): { value: string; label: string } {
  switch (metric) {
    case "wpm":
      return { value: String(Math.round(v)), label: "words a minute" };
    case "aimMs":
      return { value: `${Math.round(v)} ms`, label: "per mark" };
    case "litanyRound":
      return { value: String(Math.round(v)), label: "rounds recited" };
    case "geoPercent":
      return { value: `${Math.round(v)}%`, label: "of the gauntlet" };
    case "brazierTouches":
      return { value: String(Math.round(v)), label: "touches to light the hall" };
  }
}

/** The two figures shown on a trial that is over for the day. */
function verdictFacts(id: SectionId, o: TrialOutcome): { value: string; label: string }[] {
  const facts: { value: string; label: string }[] = [];
  if (id === "wordle" && o.guesses) {
    facts.push({ value: String(o.guesses), label: o.state === "done" ? "guesses taken" : "guesses spent" });
  } else if (o.score && o.state === "done") {
    facts.push(fmtScore(o.score.metric, o.score.value));
  } else if (o.state === "failed" && o.fails) {
    facts.push({ value: String(o.fails), label: o.fails === 1 ? "try spent" : "tries spent" });
  }
  if (o.state === "done") {
    facts.push({ value: `+${(o.coins ?? 0).toLocaleString("en-US")}`, label: "coins banked" });
  } else {
    facts.push({ value: "0", label: "coins today" });
  }
  return facts;
}

/*
 * The raid and the streak each take several trips to the database, and nothing
 * else on the page depends on them. So the page is sent without them — the
 * banner, the trials and their state arrive after two short queries — and these
 * three pieces are streamed into their places as each is ready.
 */

/** One read of the raid, shared by the countdown and the banner. */
const raidState = cache((discordId: string | undefined) => getBossState(discordId));

async function RaidCountdown({ discordId }: { discordId: string | undefined }) {
  const raid = raidCountdown(await raidState(discordId));
  return <BossCountdown target={raid.target} serverNow={raid.now} live={raid.live} />;
}

async function RaidBanner({ discordId }: { discordId: string | undefined }) {
  const boss = await raidState(discordId);
  if (boss.status !== "active") return null;
  const left = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
  return (
    <Link href="/boss" className={`${styles.raid} rise`}>
      <span className={styles.raidArt} aria-hidden="true">
        <ArtImage art="boss" sizes="(min-width: 760px) 720px, 100vw" />
      </span>
      <span className={styles.raidLive}>
        <i aria-hidden="true" />
        {boss.adminOnly ? "Test raid" : "Raid live"}
      </span>
      <span className={styles.raidMain}>
        <strong className={styles.raidName}>{boss.name}</strong>
        <span className={styles.raidHp} aria-hidden="true">
          <span style={{ transform: `scaleX(${left})` }} />
        </span>
        <span className={styles.raidMeta}>
          <b>{Math.ceil(left * 100)}%</b> health · <b>{bossTimeLeft(boss.expiresAt)}</b> left ·{" "}
          {boss.adminOnly ? (
            "admins only"
          ) : (
            <>
              fell it for a share of <b>{boss.rewardPool.toLocaleString("en-US")}</b> — fight and fail and you
              lose <em>{boss.penaltyEach.toLocaleString("en-US")}</em>
            </>
          )}
        </span>
      </span>
      <span className={styles.raidCta}>
        <Swords size={15} /> Join the fight
      </span>
    </Link>
  );
}

async function StreakNote({ discordId }: { discordId: string | undefined }) {
  const streak = discordId ? await getUserStreak(discordId) : null;
  if (!streak || streak.current <= 0) return <span className="rise">resets at midnight</span>;
  return (
    <Link href="/me" className={`${styles.streak} rise`}>
      <Flame size={13} strokeWidth={2} />
      {streak.current}-day streak
    </Link>
  );
}

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const discordId = session.user.discordId;
  const [outcomes, disabledSections] = discordId
    ? await Promise.all([getTodayOutcomes(discordId), getDisabledSections()])
    : [new Map<SectionId, TrialOutcome>(), new Map<SectionId, string | null>()];
  const returnsIn = timeToReset();

  const [sectionIds, rewards, geo] = await Promise.all([
    getVisibleSectionIds(),
    getSectionRewards(),
    getGeodashEconomy(),
  ]);
  const doneCount = sectionIds.filter((id) => outcomes.get(id)?.state === "done").length;

  return (
    <AppFrame flow="/dashboard" raidAlert={false}>
      <PageHero
        art="trials"
        eyebrow="The Trials"
        title="Today&apos;s grace"
        scene={
          <Suspense fallback={null}>
            <RaidCountdown discordId={discordId} />
          </Suspense>
        }
        aside={
          <div className={styles.tally}>
            <span className={styles.tallyNum}>
              {doneCount}
              <small>/{sectionIds.length}</small>
            </span>
            <span className={styles.tallyLabel}>bested today</span>
          </div>
        }
      >
        <p className={styles.meta}>
          <span className="mono">{getChallengeDateString()}</span>
          <span className={styles.sep} />
          <Suspense fallback={null}>
            <StreakNote discordId={discordId} />
          </Suspense>
        </p>
      </PageHero>

      <div className="container">
        <Suspense fallback={null}>
          <RaidBanner discordId={discordId} />
        </Suspense>

        {/* a hall of banners, one per trial: the one under the pointer widens */}
        <div className={`${styles.gates} stagger`}>
          {sectionIds.map((id) => {
            const section = SECTIONS[id];
            const meta = META[id];
            const outcome = outcomes.get(id);
            const done = outcome?.state === "done";
            const closed = !done && disabledSections.has(id);
            const failed = !done && !closed && outcome?.state === "failed";
            // over for the day, one way or the other: say how it went
            const verdict = outcome && (done || failed) ? outcome : null;

            return (
              <TrialGate
                key={id}
                href={section.href}
                clip={closed ? undefined : ENTER_CLIPS[meta.art]}
                className={`${styles.gate} ${
                  done ? styles.gateDone : closed ? styles.gateClosed : failed ? styles.gateFailed : ""
                }`}
              >
                <span className={styles.gateFrame} aria-hidden="true">
                  <span className={styles.gateArt} data-gate-art="">
                    <ArtImage
                      art={meta.art}
                      sizes="(min-width: 1000px) 900px, 100vw"
                      className={styles.gateImg}
                    />
                  </span>
                  <span className={styles.gateShade} />
                </span>

                <span className={styles.medal} aria-hidden="true">
                  <span className={styles.medalOrbit} />
                  <meta.icon size={24} strokeWidth={1.4} />
                </span>

                <span
                  className={`stamp ${
                    done ? "stamp--done" : closed ? "stamp--closed" : failed ? "stamp--failed" : "stamp--open"
                  }`}
                >
                  {done ? <ShieldCheck /> : closed ? <Lock /> : failed ? <XCircle /> : <Flame />}
                  {done ? "Bested" : closed ? "Closed" : failed ? "Failed" : "Open"}
                </span>
                <h2 className={styles.gateName}>
                  <span>{section.label}</span>
                </h2>
                {verdict ? (
                  <span className={`${styles.verdict} ${done ? styles.verdictWon : styles.verdictLost}`}>
                    <span className={styles.verdictHead}>
                      {done ? <ShieldCheck size={15} /> : <XCircle size={15} />}
                      {done ? "Trial bested" : "Trial lost"}
                      {done && verdict.at && <small>at {formatChallengeClock(verdict.at)}</small>}
                    </span>
                    <span className={styles.verdictFacts}>
                      {verdictFacts(id, verdict).map((f) => (
                        <span key={f.label}>
                          <b>{f.value}</b>
                          {f.label}
                        </span>
                      ))}
                    </span>
                  </span>
                ) : (
                  <p className={styles.gateBlurb}>{meta.blurb}</p>
                )}

                <span className={styles.gateFoot}>
                  {verdict ? (
                    <span className={styles.returns} title="A new trial at the day's reset">
                      <Hourglass size={13} />
                      Returns in <b>{returnsIn}</b>
                    </span>
                  ) : (
                    <span className="rune">
                      <Coins />
                      {id === "geodash" ? `${geo.entry}+ stake` : rewards[id]}
                    </span>
                  )}
                  <span className={styles.enter}>
                    {done ? "Review" : closed ? "Closed" : failed ? "See" : "Enter"}
                    <ArrowRight size={14} />
                  </span>
                </span>
              </TrialGate>
            );
          })}
        </div>
      </div>
    </AppFrame>
  );
}
