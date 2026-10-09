import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { getAdminState, newEnrolTicket, setupKeyConfigured } from "@/lib/admin-auth";
import { MIN_PASSWORD_LENGTH, otpauthUri } from "@/lib/admin-crypto";
import { AppFrame } from "@/components/AppFrame";
import { SetupForm } from "@/app/admin/GateForms";
import styles from "@/app/admin/admin.module.css";

export const dynamic = "force-dynamic";

export default async function AdminSetupPage() {
  const state = await getAdminState();
  if (state.kind === "none") notFound();
  if (state.kind === "locked") redirect("/admin/unlock");
  if (state.kind === "ok") redirect("/admin");

  const ready = setupKeyConfigured();
  // A fresh secret per page load. It is only stored once the form below
  // proves the setup key, and that the authenticator really has it.
  const { secret, ticket } = newEnrolTicket(state.discordId);
  const qrSvg = ready
    ? await QRCode.toString(otpauthUri(secret, "admin", "Daily Challenges"), {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M",
      })
    : "";

  return (
    <AppFrame back={{ href: "/dashboard", label: "Back to trials" }}>
      <div className="container">
        <section className={`${styles.gate} rise`}>
          <p className="eyebrow">Warden&apos;s Ledger</p>
          <h1 className={styles.gateTitle}>Set up admin access</h1>

          {!ready ? (
            <p className={styles.gateText}>
              Admin access can&apos;t be set up yet: the server has no{" "}
              <code>ADMIN_SETUP_KEY</code>. Add one (16+ characters) to the
              site&apos;s environment variables, redeploy, and reload this page.
            </p>
          ) : (
            <>
              <p className={styles.gateText}>
                From now on the admin panel needs three things: your Discord
                login, a password, and a code from an authenticator app.
              </p>
              <ol className={styles.gateSteps}>
                <li>
                  Open Google Authenticator, Authy, or any authenticator app and
                  scan this code (or type the key under it).
                </li>
                <li>Choose an admin password you don&apos;t use anywhere else.</li>
                <li>Enter the 6-digit code the app shows to confirm.</li>
              </ol>
              <div className={styles.qr}>
                <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
                <span className={`mono ${styles.qrSecret}`}>
                  {secret.match(/.{1,4}/g)?.join(" ")}
                </span>
              </div>
              <SetupForm ticket={ticket} minPassword={MIN_PASSWORD_LENGTH} />
            </>
          )}
        </section>
      </div>
    </AppFrame>
  );
}
