import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { CAUGHT_HEADER } from "@/lib/alt-guard";
import styles from "./caught.module.css";

export const metadata: Metadata = { title: "Caught · Daily Challenges", robots: { index: false } };

/**
 * What an alt account sees on every page (the proxy rewrites here). Typed in
 * directly by anyone else, it isn't there.
 */
export default async function CaughtPage() {
  if ((await headers()).get(CAUGHT_HEADER) !== "1") notFound();

  return (
    <main className="page-main">
      <div className={`container ${styles.wrap}`}>
        <div className={`panel panel--lit ornate ${styles.card}`}>
          <p className={styles.kicker}>A message lies on the ground</p>
          <h1 className={styles.title}>Alt account ahead</h1>
          <p className={styles.body}>
            You were warned in the Discord. And yet here you stand, a second face on the same
            Tarnished, hoping the trials would pay you twice.
          </p>
          <p className={styles.eye} aria-hidden>
            👁
          </p>
          <p className={styles.seen}>I see you as well.</p>
          <p className={styles.sub}>And your main. And that other one you thought I missed.</p>
          <p className={styles.body}>
            The trials, the raids and the coin are sealed to this account. Go back to your main,
            where your grace was first kindled.
          </p>
          <p className={styles.quip}>Try alt account, but hole.</p>
          <div className={styles.actions}>
            {/* a full page load into the sign-in routes, which the proxy leaves open */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/api/auth/signout" className="btn btn--gold btn--sm">
              Leave in shame
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
