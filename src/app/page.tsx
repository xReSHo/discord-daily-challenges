import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Grid3x3, Keyboard, Crosshair, Orbit } from "lucide-react";
import { doSignIn } from "./actions";
import { Sigil } from "@/components/Sigil";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getChallengeDateString } from "@/lib/challenge-date";
import styles from "./page.module.css";

const TRIALS = [
  { icon: Grid3x3, name: "Wordle", line: "Six guesses. One word for all." },
  { icon: Keyboard, name: "Typing Test", line: "Speed and precision, timed." },
  { icon: Crosshair, name: "Aim Trainer", line: "Twenty marks. Beat the clock." },
  { icon: Orbit, name: "The Litany", line: "Recite the rite from memory." },
];

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

  return (
    <main className={styles.landing}>
      <ThemeToggle className="theme-toggle--corner" />
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
            <button type="submit" className="btn btn--gold">
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

        <section className={styles.trials}>
          {TRIALS.map(({ icon: Icon, name, line }) => (
            <article key={name} className={`panel panel--lit ${styles.trial}`}>
              <Icon size={22} className={styles.trialIcon} strokeWidth={1.4} />
              <h3 className={styles.trialName}>{name}</h3>
              <p className={styles.trialLine}>{line}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
