import { CircleAlert, CircleCheck } from "lucide-react";
import styles from "./admin.module.css";

type SearchParams = { [key: string]: string | string[] | undefined };

/** The `?ok=` / `?err=` message an action redirected back with, if any. */
export function readFlash(params: SearchParams): { ok?: string; err?: string } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return { ok: one(params.ok)?.slice(0, 300), err: one(params.err)?.slice(0, 300) };
}

/**
 * The body of one admin page: its title and the result of the last action.
 * The frame around it — site header, section nav, session timer — lives in
 * `(panel)/layout.tsx` and stays mounted while you move between sections, so
 * switching sections only ever renders this part.
 */
export function AdminShell({
  title,
  flash,
  children,
}: {
  title: string;
  flash?: { ok?: string; err?: string };
  children: React.ReactNode;
}) {
  return (
    <>
      <h1 className={styles.pageTitle}>{title}</h1>

      {flash?.err && (
        <p className={`${styles.flash} ${styles.flashBad}`} role="alert">
          <CircleAlert size={15} /> {flash.err}
        </p>
      )}
      {flash?.ok && !flash.err && (
        <p className={styles.flash} role="status">
          <CircleCheck size={15} /> {flash.ok}
        </p>
      )}

      {children}
    </>
  );
}

export function Field({
  label,
  hint,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`${styles.field} ${wide ? styles.fieldWide : ""}`}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint && <span className={styles.fieldHint}>{hint}</span>}
    </label>
  );
}

/** Grey placeholder block shown while a section's data is on its way. */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className={styles.skeleton} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <span key={i} className={styles.skeletonRow} />
      ))}
    </div>
  );
}
