import Link from "next/link";
import { Lock, ArrowLeft } from "lucide-react";
import styles from "./SectionClosed.module.css";

/** Shown in place of a game when an admin has taken it offline. */
export function SectionClosed({ title, note }: { title: string; note: string | null }) {
  return (
    <div className={`panel panel--lit ${styles.wrap} rise`}>
      <span className={styles.mark} aria-hidden>
        <Lock size={22} strokeWidth={1.5} />
      </span>
      <h2 className={styles.title}>{title} is closed</h2>
      <p className={styles.text}>
        {note?.trim()
          ? note
          : "This trial is temporarily closed for maintenance. Check back a little later."}
      </p>
      <Link href="/dashboard" className={styles.back}>
        <ArrowLeft size={14} /> Back to the trials
      </Link>
    </div>
  );
}
