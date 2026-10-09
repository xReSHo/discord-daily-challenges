import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Crosshair, FlameKindling, Grid3x3, Keyboard, Orbit, Swords, Triangle, type LucideIcon } from "lucide-react";
import { doSignIn } from "./actions";
import { ArtImage } from "@/components/ArtImage";
import { Sigil } from "@/components/Sigil";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getVisibleSectionIds } from "@/lib/section-status";
import { SECTIONS, type SectionId } from "@/lib/sections";
import styles from "./page.module.css";

const TRIALS: Record<SectionId, { icon: LucideIcon; line: string }> = {
  wordle: { icon: Grid3x3, line: "Six guesses. One word for all." },
  typing: { icon: Keyboard, line: "Speed and precision, timed." },
  aim: { icon: Crosshair, line: "Moving marks. Five misses." },
  litany: { icon: Orbit, line: "Recite the rite from memory." },
  geodash: { icon: Triangle, line: "Stake your coin on the gauntlet." },
  braziers: { icon: FlameKindling, line: "Light the hall in the fewest touches." },
};

function DiscordMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3c-.2.36-.43.845-.588 1.23a18.27 18.27 0 0 0-5.94 0A12.5 12.5 0 0 0 9.44 3a19.74 19.74 0 0 0-3.76 1.369C1.92 9.046 1.03 13.58 1.42 18.05A19.9 19.9 0 0 0 7.5 21c.49-.67.93-1.38 1.31-2.13-.72-.27-1.4-.6-2.05-.99.17-.13.34-.26.5-.4a14.2 14.2 0 0 0 12.48 0c.16.14.33.27.5.4-.65.39-1.34.72-2.06.99.38.75.82 1.46 1.31 2.13a19.86 19.86 0 0 0 6.08-2.95c.46-5.18-.78-9.68-3.26-13.68ZM8.68 15.33c-1.18 0-2.15-1.09-2.15-2.42 0-1.34.95-2.42 2.15-2.42 1.2 0 2.17 1.09 2.15 2.42 0 1.33-.95 2.42-2.15 2.42Zm6.64 0c-1.18 0-2.15-1.09-2.15-2.42 0-1.34.95-2.42 2.15-2.42 1.2 0 2.17 1.09 2.15 2.42 0 1.33-.95 2.42-2.15 2.42Z" />
    </svg>
  );
}

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  // only the trials that are actually on offer (kept in memory for a minute,
  // so this does not cost a database trip per visitor)
  const trials = await getVisibleSectionIds();

  return (
    <main className={styles.landing}>
      <div className={styles.backdrop} aria-hidden="true">
        <ArtImage art="hero" sizes="100vw" eager className={styles.backdropImg} />
        <span className={styles.backdropFog} />
        <span className={styles.backdropShade} />
      </div>

      <div className={`container ${styles.inner}`}>
        <section className={`${styles.hero} stagger`}>
          <Sigil size={64} className={styles.sigil} />

          <p className="eyebrow">Daily Challenges</p>

          <h1 className={styles.title}>
            One grace per day.
            <span className={styles.titleFade}> Face the trial, claim the reward.</span>
          </h1>

          <p className={`lede ${styles.lede}`}>
            A new set of trials appears each day at dawn and is the same for
            everyone. Best them once, earn your currency, and return when the
            world resets.
          </p>

          <form action={doSignIn} className={styles.cta}>
            <button type="submit" className={`btn btn--gold ${styles.enter}`}>
              <DiscordMark />
              Enter with Discord
            </button>
          </form>

          <p className={styles.today}>
            <span className="mono">{getChallengeDateString()}</span>
            <span className={styles.dot} />
            <span>trials await</span>
          </p>
        </section>

        <section className={`${styles.trials} stagger`} aria-label="What awaits">
          {trials.map((id) => {
            const { icon: Icon, line } = TRIALS[id];
            return (
              <article key={id} className={`panel panel--lit ornate ornate--live ${styles.trial}`}>
                <Icon size={22} className={styles.trialIcon} strokeWidth={1.4} />
                <div>
                  <h2 className={styles.trialName}>{SECTIONS[id].label}</h2>
                  <p className={styles.trialLine}>{line}</p>
                </div>
              </article>
            );
          })}
          <article className={`panel panel--lit ornate ornate--live ${styles.trial}`}>
            <Swords size={22} className={styles.trialIcon} strokeWidth={1.4} />
            <div>
              <h2 className={styles.trialName}>The Weekly Raid</h2>
              <p className={styles.trialLine}>One great foe. The whole server strikes.</p>
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
