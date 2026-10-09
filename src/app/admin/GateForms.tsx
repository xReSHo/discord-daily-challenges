"use client";

import { useActionState } from "react";
import { CircleAlert } from "lucide-react";
import { enrolAction, unlockAction, type GateState } from "./actions";
import styles from "./admin.module.css";

const START: GateState = { error: null };

function GateError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className={`${styles.flash} ${styles.flashBad}`} role="alert">
      <CircleAlert size={15} /> {error}
    </p>
  );
}

function CodeInput() {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>6-digit code</span>
      <input
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]{6,7}"
        maxLength={7}
        required
        className={`${styles.input} ${styles.codeInput}`}
      />
    </label>
  );
}

/** Step two of every admin visit: password + authenticator code. */
export function UnlockForm({ trustDays }: { trustDays: number }) {
  const [state, action, pending] = useActionState(unlockAction, START);
  return (
    <form action={action} className={styles.gateForm}>
      <GateError error={state.error} />
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Admin password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          className={styles.input}
        />
      </label>
      <CodeInput />
      <label className={styles.trust}>
        <input type="checkbox" name="trust" defaultChecked />
        <span>
          <b>Trust this browser for {trustDays} days</b>
          <small>
            You won&apos;t be asked again here until then. Untick it on a
            computer that isn&apos;t yours — it will lock itself after an hour.
          </small>
        </span>
      </label>
      <button type="submit" disabled={pending} className={`${styles.gameBtn} ${styles.primaryBtn}`}>
        {pending ? "Checking…" : "Unlock admin"}
      </button>
    </form>
  );
}

/** One-time enrolment: setup key, a new password, and a first code from the
 *  authenticator that just scanned the QR. */
export function SetupForm({ ticket, minPassword }: { ticket: string; minPassword: number }) {
  const [state, action, pending] = useActionState(enrolAction, START);
  return (
    <form action={action} className={styles.gateForm}>
      <GateError error={state.error} />
      <input type="hidden" name="ticket" value={ticket} />
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Setup key</span>
        <input
          name="setupKey"
          type="password"
          autoComplete="off"
          required
          className={styles.input}
        />
        <span className={styles.fieldHint}>
          The ADMIN_SETUP_KEY value from the site&apos;s environment variables.
        </span>
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>New admin password</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={minPassword}
          required
          className={styles.input}
        />
        <span className={styles.fieldHint}>At least {minPassword} characters.</span>
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Repeat password</span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={minPassword}
          required
          className={styles.input}
        />
      </label>
      <CodeInput />
      <button type="submit" disabled={pending} className={`${styles.gameBtn} ${styles.primaryBtn}`}>
        {pending ? "Setting up…" : "Finish setup"}
      </button>
    </form>
  );
}
