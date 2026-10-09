import { KeyRound, LogOut } from "lucide-react";
import { Prisma } from "@prisma/client";
import { asDate, loadAdminPage } from "@/lib/admin-auth";
import { adminCount } from "@/lib/admin";
import { formatAdminTime, formatAdminTimeFull } from "@/lib/challenge-date";
import { lockAction, lockEverywhereAction } from "@/app/admin/actions";
import { AdminShell, readFlash } from "@/app/admin/ui";
import { SubmitButton } from "@/app/admin/controls";
import styles from "@/app/admin/admin.module.css";

export const dynamic = "force-dynamic";

type SearchParams = { [key: string]: string | string[] | undefined };

function tone(action: string): string {
  if (action.includes("failed") || action.includes("bad_") || action.includes("delete")) {
    return styles.pillBad;
  }
  if (action.startsWith("unlock") || action.startsWith("lock") || action.startsWith("enrol")) {
    return styles.pillWarn;
  }
  return styles.pillOk;
}

export default async function AdminSecurityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // The admin check and everything this tab shows, in one round trip. Only
  // the two harmless columns of the credential table are read.
  const { discordId, expiresAt, trusted, data } = await loadAdminPage({
    creds: Prisma.sql`SELECT "discordId", "createdAt" FROM "AdminCredential"`,
    audit: Prisma.sql`SELECT * FROM "AdminAudit" ORDER BY "createdAt" DESC LIMIT 150`,
  });
  const creds = data.creds.map((c) => ({
    discordId: String(c.discordId),
    createdAt: asDate(c.createdAt),
  }));
  const audit = data.audit.map((a) => ({
    id: String(a.id),
    discordId: String(a.discordId),
    action: String(a.action),
    detail: a.detail,
    ip: typeof a.ip === "string" ? a.ip : null,
    createdAt: asDate(a.createdAt),
  }));
  const cred = creds.find((c) => c.discordId === discordId);
  const enrolled = creds.length;

  return (
    <AdminShell
      title="Security"
      flash={readFlash(await searchParams)}
    >
      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Your admin access</h3>
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>
              <KeyRound size={14} /> Discord + password + authenticator
            </span>
            <span className={styles.cardSub}>
              Set up {cred ? formatAdminTime(cred.createdAt) : "—"} · {adminCount()} Discord ID
              {adminCount() === 1 ? "" : "s"} allowed, {enrolled} set up
            </span>
          </div>
          <p className={styles.panelNote}>
            {trusted ? (
              <>
                <b>This browser is trusted until {formatAdminTime(new Date(expiresAt))}.</b> Until
                then it opens the admin pages without asking again. Any other browser still needs
                your Discord login, the password and a code.
              </>
            ) : (
              <>
                <b>This browser is unlocked until {formatAdminTime(new Date(expiresAt))}.</b> Tick
                “Trust this browser” the next time you unlock to stop being asked on your own
                computer.
              </>
            )}
          </p>
          <p className={styles.panelNote}>
            Lost your phone or forgot the password? Run{" "}
            <code>node scripts/admin-reset.mjs</code> from the project folder, then
            set up again at /admin/setup with the setup key. Nobody can reset it
            from the website.
          </p>
          <div className={styles.formActions}>
            <form action={lockAction}>
              <button type="submit" className={styles.gameBtn}>
                <LogOut size={11} /> Lock this browser
              </button>
            </form>
            <form action={lockEverywhereAction}>
              <SubmitButton
                tone="danger"
                busy="Locking…"
                confirm="Lock every browser, including trusted ones? Each will need the password and a code again."
              >
                Lock every browser
              </SubmitButton>
            </form>
          </div>
        </div>
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>
          Audit log <span className={styles.count}>({audit.length})</span>
        </h3>
        {audit.length === 0 ? (
          <p className={styles.empty}>Nothing recorded yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Admin</th>
                  <th>Action</th>
                  <th>Detail</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => {
                  const detail = JSON.stringify(a.detail);
                  return (
                    <tr key={a.id}>
                      <td className={`mono ${styles.timeCell}`} title={formatAdminTimeFull(a.createdAt)}>
                        {formatAdminTime(a.createdAt)}
                      </td>
                      <td className="mono">{a.discordId}</td>
                      <td>
                        <span className={`${styles.pill} ${tone(a.action)}`}>{a.action}</span>
                      </td>
                      <td className={`mono ${styles.detail}`} title={detail}>
                        {detail === "{}" ? "—" : detail}
                      </td>
                      <td className="mono">{a.ip ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
