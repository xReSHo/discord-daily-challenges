import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ShieldAlert,
  Coins,
  CircleCheck,
  TriangleAlert,
  MessageSquare,
  ShoppingBag,
  Swords,
  Triangle,
  XCircle,
  Bot,
} from "lucide-react";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { AppFrame } from "@/components/AppFrame";
import {
  getAdminOverview,
  type AdminOverview,
  type AdminFilters,
} from "@/lib/admin-data";
import { getChallengeDateString } from "@/lib/challenge-date";
import { SECTIONS, isSectionId } from "@/lib/sections";
import { logger } from "@/lib/logger";
import styles from "./admin.module.css";

// Always current — never prerender or cache an operator view.
export const dynamic = "force-dynamic";

const CHALLENGE_TZ = process.env.CHALLENGE_TZ || "Asia/Bahrain";

function sectionLabel(id: string): string {
  if (id === "boss") return "Boss Raid";
  return isSectionId(id) ? SECTIONS[id].label : id;
}

/** Plain UTC timestamp — used where exact wall-clock precision matters most. */
function when(d: Date): string {
  return new Date(d).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

/** 12-hour clock in the challenge timezone, for the Recent completions log. */
function whenAmPm(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CHALLENGE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(d));
}

function shortId(discordId: string): string {
  return discordId.length > 10
    ? `${discordId.slice(0, 6)}…${discordId.slice(-4)}`
    : discordId;
}

type SearchParams = { [key: string]: string | string[] | undefined };

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
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

  const params = await searchParams;
  const filters: AdminFilters = {
    q: firstParam(params.q),
    from: firstParam(params.from),
    to: firstParam(params.to),
  };
  const hasFilters = Boolean(filters.q || filters.from || filters.to);

  let data: AdminOverview | null = null;
  let loadError: string | null = null;
  try {
    data = await getAdminOverview(filters);
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
            <span className={styles.sep} />
            <Link href="/admin/boss" className={styles.bossLink}>
              <Swords size={13} /> Boss control
            </Link>
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
          <Tile
            icon={<ShoppingBag size={18} />}
            label="Purchases (refunded/stuck)"
            value={data.purchasesUnfulfilled}
            tone={data.purchasesUnfulfilled > 0 ? "warn" : undefined}
          />
          <Tile
            icon={<XCircle size={18} />}
            label="Challenge fails today"
            value={data.failuresToday}
          />
          <Tile
            icon={<Triangle size={18} />}
            label="GeoDash to review"
            value={data.geoReviewCount}
            tone={data.geoReviewCount > 0 ? "bad" : undefined}
          />
          <Tile
            icon={<Bot size={18} />}
            label="Assistant fails (7 days)"
            value={data.chatIncidents7d}
            tone={data.chatIncidents7d > 0 ? "warn" : undefined}
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
                      <td>
                        <div className={styles.userCell}>
                          <span>{f.name ?? "Unknown"}</span>
                          <span
                            className={`mono ${styles.userId}`}
                            title={f.discordId}
                          >
                            {shortId(f.discordId)}
                          </span>
                        </div>
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
                      <td>
                        <div className={styles.userCell}>
                          <span>{f.name ?? "Unknown"}</span>
                          <span
                            className={`mono ${styles.userId}`}
                            title={f.discordId}
                          >
                            {shortId(f.discordId)}
                          </span>
                        </div>
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
            Assistant incidents{" "}
            <span className={styles.count}>
              ({data.recentChatIncidents.length})
            </span>
          </h2>
          {data.recentChatIncidents.length === 0 ? (
            <p className={styles.empty}>
              No assistant failures — the chatbot has been reaching its model fine.
            </p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Reason</th>
                    <th>Detail</th>
                    <th>Owner DM&apos;d</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentChatIncidents.map((c) => (
                    <tr key={c.id}>
                      <td className="mono">{when(c.createdAt)}</td>
                      <td>
                        <div className={styles.userCell}>
                          <span>{c.name ?? "Unknown"}</span>
                          <span
                            className={`mono ${styles.userId}`}
                            title={c.discordId}
                          >
                            {shortId(c.discordId)}
                          </span>
                        </div>
                      </td>
                      <td className="mono">{c.reason}</td>
                      <td
                        className={styles.detail}
                        style={{ whiteSpace: "normal" }}
                      >
                        {c.detail ?? "—"}
                      </td>
                      <td className={c.notified ? styles.ok : styles.warn}>
                        {c.notified ? "yes" : "throttled"}
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
            Shop purchases{" "}
            <span className={styles.count}>({data.recentPurchases.length})</span>
          </h2>
          {data.recentPurchases.length === 0 ? (
            <p className={styles.empty}>No shop purchases yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Item</th>
                    <th className={styles.num}>Price</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentPurchases.map((p) => (
                    <tr key={p.id}>
                      <td className="mono">{when(p.createdAt)}</td>
                      <td>
                        <div className={styles.userCell}>
                          <span>{p.name ?? "Unknown"}</span>
                          <span
                            className={`mono ${styles.userId}`}
                            title={p.discordId}
                          >
                            {shortId(p.discordId)}
                          </span>
                        </div>
                      </td>
                      <td>{p.itemName}</td>
                      <td className={`mono ${styles.num}`}>
                        {p.price.toLocaleString()}
                      </td>
                      <td
                        className={
                          p.status === "fulfilled"
                            ? styles.ok
                            : p.status === "refunded" || p.status === "failed"
                              ? styles.bad
                              : styles.warn
                        }
                      >
                        {p.status}
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
            Failed challenges{" "}
            <span className={styles.count}>({data.recentFailures.length})</span>
          </h2>
          {data.recentFailures.length === 0 ? (
            <p className={styles.empty}>No failed challenges.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Section</th>
                    <th className={styles.num}>Fails</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentFailures.map((f) => (
                    <tr key={f.id}>
                      <td className="mono">{when(f.updatedAt)}</td>
                      <td>
                        <div className={styles.userCell}>
                          <span>{f.name ?? "Unknown"}</span>
                          <span
                            className={`mono ${styles.userId}`}
                            title={f.discordId}
                          >
                            {shortId(f.discordId)}
                          </span>
                        </div>
                      </td>
                      <td>{sectionLabel(f.section)}</td>
                      <td className={`mono ${styles.num}`}>{f.fails}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.block}>
          <h2 className={styles.blockTitle}>
            Geometry Dash runs{" "}
            <span className={styles.count}>({data.recentGeoRuns.length})</span>
          </h2>
          {data.recentGeoRuns.length === 0 ? (
            <p className={styles.empty}>No staked runs yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Difficulty</th>
                    <th className={styles.num}>Stake</th>
                    <th className={styles.num}>Fees</th>
                    <th className={styles.num}>Deaths</th>
                    <th className={styles.num}>Payout</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentGeoRuns.map((g) => (
                    <tr key={g.id}>
                      <td className="mono">{when(g.resolvedAt ?? g.createdAt)}</td>
                      <td>
                        <div className={styles.userCell}>
                          <span>{g.name ?? "Unknown"}</span>
                          <span
                            className={`mono ${styles.userId}`}
                            title={g.discordId}
                          >
                            {shortId(g.discordId)}
                          </span>
                        </div>
                      </td>
                      <td>{g.difficulty}</td>
                      <td className={`mono ${styles.num}`}>
                        {g.stake.toLocaleString()}
                      </td>
                      <td className={`mono ${styles.num}`}>{g.feesPaid}</td>
                      <td className={`mono ${styles.num}`}>{g.deaths}</td>
                      <td className={`mono ${styles.num}`}>
                        {g.payout ? g.payout.toLocaleString() : "—"}
                      </td>
                      <td
                        className={
                          g.status === "won"
                            ? styles.ok
                            : g.status === "rejected"
                              ? styles.bad
                              : styles.warn
                        }
                      >
                        {g.status === "spent" || g.status === "lost"
                          ? `out @ ${Math.round(g.distancePct)}%`
                          : g.status}
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

          <form className={styles.filterBar} action="/admin" method="get">
            <input
              type="text"
              name="q"
              placeholder="Search user ID or name"
              defaultValue={filters.q ?? ""}
              className={styles.filterInput}
            />
            <input
              type="date"
              name="from"
              defaultValue={filters.from ?? ""}
              aria-label="From date"
              className={styles.filterInput}
            />
            <span className={styles.filterToLabel}>to</span>
            <input
              type="date"
              name="to"
              defaultValue={filters.to ?? ""}
              aria-label="To date"
              className={styles.filterInput}
            />
            <button type="submit" className={styles.filterButton}>
              Filter
            </button>
            {hasFilters && (
              <a href="/admin" className={styles.filterClear}>
                Clear
              </a>
            )}
          </form>

          {data.recentCompletions.length === 0 ? (
            <p className={styles.empty}>
              {hasFilters
                ? "No completions match those filters."
                : "No completions recorded yet."}
            </p>
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
                      <td className="mono">{whenAmPm(c.createdAt)}</td>
                      <td>
                        <div className={styles.userCell}>
                          <span>{c.name ?? "Unknown"}</span>
                          <span
                            className={`mono ${styles.userId}`}
                            title={c.discordId}
                          >
                            {shortId(c.discordId)}
                          </span>
                        </div>
                      </td>
                      <td>{sectionLabel(c.section)}</td>
                      <td
                        className={`mono ${styles.num} ${
                          c.rewardAmount < 0 ? styles.bad : ""
                        }`}
                      >
                        {c.rewardAmount.toLocaleString()}
                      </td>
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
