import { notFound } from "next/navigation";
import {
  ShieldAlert,
  Coins,
  CircleCheck,
  TriangleAlert,
  MessageSquare,
} from "lucide-react";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { AppFrame } from "@/components/AppFrame";
import { getAdminOverview, type AdminOverview } from "@/lib/admin-data";
import { getChallengeDateString } from "@/lib/challenge-date";
import { SECTIONS, isSectionId } from "@/lib/sections";
import { logger } from "@/lib/logger";
import styles from "./admin.module.css";

// Always current — never prerender or cache an operator view.
export const dynamic = "force-dynamic";

function sectionLabel(id: string): string {
  return isSectionId(id) ? SECTIONS[id].label : id;
}

function when(d: Date): string {
  return new Date(d).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

function shortId(discordId: string): string {
  return discordId.length > 10
    ? `${discordId.slice(0, 6)}…${discordId.slice(-4)}`
    : discordId;
}

export default async function AdminPage() {
  const session = await auth();
  const discordId = session?.user?.discordId;

  if (!isAdmin(discordId)) {
    // 404, not 403 — a non-admin gets no signal the page exists at all.
    logger.warn("admin.access_denied", {
      discordId: discordId ?? null,
      authed: Boolean(session?.user),
    });
    notFound();
  }

  let data: AdminOverview | null = null;
  let loadError: string | null = null;
  try {
    data = await getAdminOverview();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    logger.error("admin.overview_failed", { message: loadError });
  }

  return (
    <AppFrame back={{ href: "/dashboard", label: "Back to trials" }}>
      <div className="container">
        <header className={`${styles.head} rise`}>
          <p className="eyebrow">Warden&apos;s Ledger</p>
          <h1 className={styles.title}>Admin</h1>
          <p className={styles.meta}>
            <span className="mono">{getChallengeDateString()}</span>
            <span className={styles.sep} />
            <span>completions &amp; flagged attempts</span>
          </p>
        </header>

        {!data && (
          <p className={styles.empty}>
            Couldn&apos;t load the ledger
            {loadError ? ` — ${loadError}` : ""}. If this is the first deploy,
            run <code>npx prisma db push</code> to create the audit tables.
          </p>
        )}
        {data && (
        <>
        <section className={`${styles.tiles} stagger`}>
          <Tile
            icon={<CircleCheck size={18} />}
            label="Completions today"
            value={data.todayTotals.count}
          />
          <Tile
            icon={<Coins size={18} />}
            label="Paid out today"
            value={data.todayTotals.paidOut}
          />
          <Tile
            icon={<ShieldAlert size={18} />}
            label="Flags (7 days)"
            value={data.flags7d}
            tone={data.flags7d > 0 ? "warn" : undefined}
          />
          <Tile
            icon={<TriangleAlert size={18} />}
            label="Unpaid completions"
            value={data.unpaidCompletions}
            tone={data.unpaidCompletions > 0 ? "bad" : undefined}
          />
          <Tile
            icon={<MessageSquare size={18} />}
            label="Feedback (undelivered)"
            value={data.feedbackUndelivered}
            tone={data.feedbackUndelivered > 0 ? "warn" : undefined}
          />
        </section>

        <section className={styles.block}>
          <h2 className={styles.blockTitle}>Today by section</h2>
          {data.todayBySection.length === 0 ? (
            <p className={styles.empty}>No completions yet today.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Section</th>
                    <th className={styles.num}>Completions</th>
                    <th className={styles.num}>Paid out</th>
                  </tr>
                </thead>
                <tbody>
                  {data.todayBySection.map((r) => (
                    <tr key={r.section}>
                      <td>{sectionLabel(r.section)}</td>
                      <td className={styles.num}>{r.count}</td>
                      <td className={styles.num}>{r.paidOut}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.block}>
          <h2 className={styles.blockTitle}>
            Flagged attempts{" "}
            <span className={styles.count}>({data.recentFlags.length})</span>
          </h2>
          {data.recentFlags.length === 0 ? (
            <p className={styles.empty}>Nothing flagged. Clean run.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Section</th>
                    <th>Reason</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentFlags.map((f) => (
                    <tr key={f.id}>
                      <td className="mono">{when(f.createdAt)}</td>
                      <td className="mono" title={f.discordId}>
                        {shortId(f.discordId)}
                      </td>
                      <td>{sectionLabel(f.section)}</td>
                      <td className={styles.warn}>{f.reason}</td>
                      <td className={`mono ${styles.detail}`}>
                        {JSON.stringify(f.detail)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.block}>
          <h2 className={styles.blockTitle}>
            Feedback{" "}
            <span className={styles.count}>({data.recentFeedback.length})</span>
          </h2>
          {data.recentFeedback.length === 0 ? (
            <p className={styles.empty}>No reports or suggestions yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Kind</th>
                    <th>Page</th>
                    <th>Message</th>
                    <th>Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentFeedback.map((f) => (
                    <tr key={f.id}>
                      <td className="mono">{when(f.createdAt)}</td>
                      <td className="mono" title={f.discordId}>
                        {shortId(f.discordId)}
                      </td>
                      <td>{f.kind === "bug" ? "🐛 bug" : "💡 idea"}</td>
                      <td className="mono">{f.path}</td>
                      <td className={styles.detail} style={{ whiteSpace: "normal" }}>
                        {f.message}
                      </td>
                      <td className={f.delivered ? styles.ok : styles.warn}>
                        {f.delivered ? "yes" : "queued"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.block}>
          <h2 className={styles.blockTitle}>
            Recent completions{" "}
            <span className={styles.count}>({data.recentCompletions.length})</span>
          </h2>
          {data.recentCompletions.length === 0 ? (
            <p className={styles.empty}>No completions recorded yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Section</th>
                    <th className={styles.num}>Reward</th>
                    <th>Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentCompletions.map((c) => (
                    <tr key={c.id}>
                      <td className="mono">{when(c.createdAt)}</td>
                      <td className="mono" title={c.discordId}>
                        {shortId(c.discordId)}
                      </td>
                      <td>{sectionLabel(c.section)}</td>
                      <td className={styles.num}>{c.rewardAmount}</td>
                      <td className={c.rewarded ? styles.ok : styles.bad}>
                        {c.rewarded ? "yes" : "FAILED"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        </>
        )}
      </div>
    </AppFrame>
  );
}

function Tile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "warn" | "bad";
}) {
  return (
    <div className={`panel panel--lit ${styles.tile}`}>
      <span className={styles.tileIcon}>{icon}</span>
      <span
        className={`${styles.tileValue} ${
          tone === "warn" ? styles.warn : tone === "bad" ? styles.bad : ""
        }`}
      >
        {value.toLocaleString()}
      </span>
      <span className={styles.tileLabel}>{label}</span>
    </div>
  );
}
