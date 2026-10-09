"use client";

import { useFormStatus } from "react-dom";
import styles from "./admin.module.css";

/**
 * The save button of an admin form. It says so while the save is on its way —
 * the database is far away, and a button that does nothing for half a second
 * gets pressed twice.
 */
export function SubmitButton({
  children,
  busy = "Saving…",
  tone = "primary",
  confirm,
}: {
  children: React.ReactNode;
  /** What the button reads while the action runs. */
  busy?: string;
  tone?: "primary" | "plain" | "danger";
  /** Ask this first; the form is only sent on "OK". For things that can't be undone. */
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  const toneClass =
    tone === "primary" ? styles.primaryBtn : tone === "danger" ? styles.dangerBtn : "";
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${styles.gameBtn} ${toneClass}`}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? busy : children}
    </button>
  );
}
