"use client";

import { useEffect, useState } from "react";
import styles from "./CookieNotice.module.css";

/** Bump the version to show the notice again to everyone (after a change to
 *  what the site stores). */
const KEY = "cookie_notice_v1";
/** Let the loading screen clear before the message rises. */
const DELAY_MS = 1400;

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === "ok";
  } catch {
    return false; // storage blocked: show it, and it simply asks again next time
  }
}

/**
 * The one-time cookie notice, written as a message left on the ground. The
 * site keeps only what it needs: the sign-in cookies (and an admin's unlock),
 * plus the sound setting in the browser. No trackers, so this informs rather
 * than asks; "OK" hides it for good on this browser.
 */
export function CookieNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (seen()) return;
    const t = window.setTimeout(() => setOpen(true), DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  if (!open) return null;

  function dismiss() {
    try {
      localStorage.setItem(KEY, "ok");
    } catch {
      // nowhere to remember it: it shows again on the next visit
    }
    setOpen(false);
  }

  return (
    <aside className={styles.wrap} aria-label="Cookie notice">
      <div className={`panel panel--lit ornate ${styles.card}`}>
        <p className={styles.kicker}>A message lies on the ground</p>
        <h2 className={styles.title}>Behold, cookies!</h2>
        <p className={styles.body}>
          These halls keep a few small cookies to remember you between visits, so your streak, coins
          and spoils stay yours. Only the essential kind: no trackers, no ads, and nothing is sold to
          the merchants of the Roundtable.
        </p>
        <p className={styles.quip}>Try cookie, but no milk.</p>
        <div className={styles.actions}>
          <button type="button" className="btn btn--gold btn--sm" onClick={dismiss} autoFocus>
            OK
          </button>
        </div>
      </div>
    </aside>
  );
}
