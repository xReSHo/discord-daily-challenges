import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { ArrowRight, CircleCheck } from "lucide-react";
import { loadAdminPage, type JsonRow } from "@/lib/admin-auth";
import {
  LEDGER_TABS,
  ledgerParts,
  readActivity,
  readCounts,
  readEconomy,
  readGamesOffline,
  readHealth,
  readIntegrity,
  type AdminCounts,
  type AdminFilters,
  type LedgerTab,
} from "@/lib/admin-data";
import { formatAdminTime, formatAdminTimeFull } from "@/lib/challenge-date";
import { SECTIONS, isSectionId } from "@/lib/sections";
import { logger } from "@/lib/logger";
import { AdminShell, readFlash } from "@/app/admin/ui";
import styles from "@/app/admin/admin.module.css";

// Always current — never prerender or cache an operator view.
export const dynamic = "force-dynamic";

function sectionLabel(id: string): string {
  if (id === "boss") return "Boss Raid";
  return isSectionId(id) ? SECTIONS[id].label : id;
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
  const params = await searchParams;
  const filters: AdminFilters = {
    q: firstParam(params.q),
    from: firstParam(params.from),
    to: firstParam(params.to),
  };
  const hasFilters = Boolean(filters.q || filters.from || filters.to);
  const requested = firstParam(params.tab);
  const tab: TabId = TAB_IDS.includes(requested as TabId) ? (requested as TabId) : "activity";

  // One round trip: the admin check (404 for outsiders; admins who haven't
  // unlocked are sent to /admin/unlock), every number on the page, and the
  // lists of the open tab only — nothing is fetched that isn't being looked at.
  let rows: Record<string, JsonRow[]> | null = null;
  let loadError: string | null = null;
  try {
    rows = (await loadAdminPage(ledgerParts(tab, filters))).data;
  } catch (err) {
    unstable_rethrow(err); // the gate's 404 / redirect must pass through
    loadError = err instanceof Error ? err.message : String(err);
    logger.error("admin.overview_failed", { message: loadError });
  }
  const counts = rows ? readCounts(rows) : null;
  const gamesOffline = rows ? readGamesOffline(rows) : 0;

  return (
    <AdminShell title="Overview" flash={readFlash(params)}>
      {!counts || !rows ? (
        <p className={styles.empty}>
          Couldn&apos;t load the overview
          {loadError ? ` — ${loadError}` : ""}. If this is the first deploy, run{" "}
          <code>npx prisma db push</code> to create the audit tables.
        </p>
      ) : (
        <AdminBody
          counts={counts}
          rows={rows}
          tab={tab}
          filters={filters}
          hasFilters={hasFilters}
          gamesOffline={gamesOffline}
        />
      )}
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------

type Tone = "warn" | "bad";

const TAB_IDS = LEDGER_TABS;
type TabId = LedgerTab;
const TAB_LABELS: Record<TabId, string> = {
  activity: "Activity",
  economy: "Economy",
  integrity: "Integrity",
  health: "Support",
};

/** Link to a ledger tab, carrying the current search filters along. */
function tabHref(tab: TabId, filters: AdminFilters): string {
  const qs = new URLSearchParams();
  if (tab !== "activity") qs.set("tab", tab);
  if (filters.q) qs.set("q", filters.q);
  if (filters.from) qs.set("from", filters.from);
  if (filters.to) qs.set("to", filters.to);
  const str = qs.toString();
  return str ? `/admin?${str}` : "/admin";
}

function AdminBody({
  counts,
  rows,
  tab,
  filters,
  hasFilters,
  gamesOffline,
}: {
  counts: AdminCounts;
  rows: Record<string, JsonRow[]>;
  tab: TabId;
  filters: AdminFilters;
  hasFilters: boolean;
  gamesOffline: number;
}) {
  // Only things an admin can act on, each a link to where it is dealt with.
  const alerts: { label: string; count: number; tab: string; tone: Tone }[] = [
    { label: "Flagged attempts this week", count: counts.flags7d, tab: "integrity", tone: "bad" },
    { label: "GeoDash runs to review", count: counts.geoReviewCount, tab: "economy", tone: "bad" },
    { label: "Purchases stuck", count: counts.purchasesUnfulfilled, tab: "economy", tone: "warn" },
    { label: "Completions not paid", count: counts.unpaidCompletions, tab: "activity", tone: "bad" },
    { label: "Feedback not delivered", count: counts.feedbackUndelivered, tab: "health", tone: "warn" },
    { label: "Duel payments owed", count: counts.duelsOwed, tab: "pit", tone: "bad" },
    { label: "Repeat finds not paid", count: counts.dropsOwed, tab: "equipment", tone: "warn" },
    { label: "Games switched off", count: gamesOffline, tab: "games", tone: "warn" },
  ];
  const live = alerts.filter((a) => a.count > 0);
  const badge = (tab: string) =>
    alerts.filter((a) => a.tab === tab).reduce((n, a) => n + a.count, 0) || undefined;
  const alertHref = (tab: string) =>
    tab === "games" || tab === "pit" || tab === "equipment" ? `/admin/${tab}` : tabHref(tab as TabId, {});

  const panel =
    tab === "economy" ? (
      <EconomyPanel data={readEconomy(rows)} />
    ) : tab === "integrity" ? (
      <IntegrityPanel data={readIntegrity(rows)} />
    ) : tab === "health" ? (
      <HealthPanel data={readHealth(rows)} />
    ) : (
      <ActivityPanel data={readActivity(rows)} filters={filters} hasFilters={hasFilters} />
    );

  return (
    <>
      <section className={styles.summary}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{counts.completionsToday.toLocaleString()}</span>
          <span className={styles.statLabel}>Completions today</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{counts.paidOutToday.toLocaleString()}</span>
          <span className={styles.statLabel}>Coins paid out today</span>
        </div>
        <div className={styles.attn}>
          <span className={styles.statLabel}>Needs attention</span>
          {live.length === 0 ? (
            <p className={styles.allClear}>
              <CircleCheck size={15} /> Nothing — all clear.
            </p>
          ) : (
            <div className={styles.alertRow}>
              {live.map((a) => (
                <Link
                  key={a.label}
                  href={alertHref(a.tab)}
                  prefetch={false}
                  scroll={false}
                  className={`${styles.alert} ${a.tone === "bad" ? styles.alertBad : styles.alertWarn}`}
                >
                  <span className={styles.alertNum}>{a.count.toLocaleString()}</span>
                  <span className={styles.alertLabel}>{a.label}</span>
                  <ArrowRight size={12} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className={styles.tabs}>
        <div className={styles.tabBar} role="tablist">
          {TAB_IDS.map((id) => {
            const count = badge(id);
            return (
              <Link
                key={id}
                href={tabHref(id, filters)}
                role="tab"
                aria-selected={id === tab}
                scroll={false}
                prefetch={false}
                className={`${styles.tab} ${id === tab ? styles.tabOn : ""}`}
              >
                {TAB_LABELS[id]}
                {count ? <span className={styles.tabBadge}>{count}</span> : null}
              </Link>
            );
          })}
        </div>
        <div role="tabpanel" className={styles.tabPanel}>
          {panel}
        </div>
      </div>
    </>
  );
}

// --- tab panels --------------------------------------------------------------

function ActivityPanel({
  data,
  filters,
  hasFilters,
}: {
  data: ReturnType<typeof readActivity>;
  filters: AdminFilters;
  hasFilters: boolean;
}) {
  return (
    <>
      <Panel
        title="Recent completions"
        count={data.recentCompletions.length}
        empty={
          hasFilters ? "No completions match those filters." : "No completions recorded yet."
        }
        always={
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
        }
      >
        <LogTable head={["When", "User", "Section", "Reward", "Paid"]} numCols={[3]}>
          {data.recentCompletions.map((c) => (
            <tr key={c.id}>
              <TimeCell d={c.createdAt} />
              <UserCell name={c.name} discordId={c.discordId} />
              <td>{sectionLabel(c.section)}</td>
              <td className={`${styles.num} mono ${c.rewardAmount < 0 ? styles.bad : ""}`}>
                {c.rewardAmount.toLocaleString()}
              </td>
              <td>
                <Pill tone={c.rewarded ? "ok" : "bad"}>{c.rewarded ? "paid" : "FAILED"}</Pill>
              </td>
            </tr>
          ))}
        </LogTable>
      </Panel>

      <Panel
        title="Today by section"
        count={data.todayBySection.length}
        empty="No completions yet today."
      >
        <LogTable head={["Section", "Completions", "Paid out"]} numCols={[1, 2]}>
          {data.todayBySection.map((r) => (
            <tr key={r.section}>
              <td>{sectionLabel(r.section)}</td>
              <td className={`${styles.num} mono`}>{r.count}</td>
              <td className={`${styles.num} mono`}>{r.paidOut.toLocaleString()}</td>
            </tr>
          ))}
        </LogTable>
      </Panel>
    </>
  );
}

function EconomyPanel({ data }: { data: ReturnType<typeof readEconomy> }) {
  return (
    <>
      <Panel
        title="Shop purchases"
        count={data.recentPurchases.length}
        empty="No shop purchases yet."
      >
        <LogTable head={["When", "User", "Item", "Price", "Status"]} numCols={[3]}>
          {data.recentPurchases.map((p) => (
            <tr key={p.id}>
              <TimeCell d={p.createdAt} />
              <UserCell name={p.name} discordId={p.discordId} />
              <td>{p.itemName}</td>
              <td className={`${styles.num} mono`}>{p.price.toLocaleString()}</td>
              <td>
                <Pill
                  tone={
                    p.status === "fulfilled"
                      ? "ok"
                      : p.status === "refunded" || p.status === "failed"
                        ? "bad"
                        : "warn"
                  }
                >
                  {p.status}
                </Pill>
              </td>
            </tr>
          ))}
        </LogTable>
      </Panel>

      <Panel
        title="Geometry Dash runs"
        count={data.recentGeoRuns.length}
        empty="No staked runs yet."
      >
        <LogTable
          head={["When", "User", "Difficulty", "Stake", "Fees", "Deaths", "Payout", "Result"]}
          numCols={[3, 4, 5, 6]}
        >
          {data.recentGeoRuns.map((g) => (
            <tr key={g.id}>
              <TimeCell d={g.resolvedAt ?? g.createdAt} />
              <UserCell name={g.name} discordId={g.discordId} />
              <td>{g.difficulty}</td>
              <td className={`${styles.num} mono`}>{g.stake.toLocaleString()}</td>
              <td className={`${styles.num} mono`}>{g.feesPaid}</td>
              <td className={`${styles.num} mono`}>{g.deaths}</td>
              <td className={`${styles.num} mono`}>
                {g.payout ? g.payout.toLocaleString() : "—"}
              </td>
              <td>
                <Pill tone={g.status === "won" ? "ok" : g.status === "rejected" ? "bad" : "warn"}>
                  {g.status === "spent" || g.status === "lost"
                    ? `out @ ${Math.round(g.distancePct)}%`
                    : g.status}
                </Pill>
              </td>
            </tr>
          ))}
        </LogTable>
      </Panel>
    </>
  );
}

function IntegrityPanel({ data }: { data: ReturnType<typeof readIntegrity> }) {
  return (
    <>
      <Panel
        title="Flagged attempts"
        count={data.recentFlags.length}
        empty="Nothing flagged. Clean run."
      >
        <LogTable head={["When", "User", "Section", "Reason", "Detail"]}>
          {data.recentFlags.map((f) => (
            <tr key={f.id}>
              <TimeCell d={f.createdAt} />
              <UserCell name={f.name} discordId={f.discordId} />
              <td>{sectionLabel(f.section)}</td>
              <td>
                <Pill tone="warn">{f.reason}</Pill>
              </td>
              <td className={`mono ${styles.detail}`} title={JSON.stringify(f.detail)}>
                {JSON.stringify(f.detail)}
              </td>
            </tr>
          ))}
        </LogTable>
      </Panel>

      <Panel
        title="Failed challenges"
        count={data.recentFailures.length}
        empty="No failed challenges."
      >
        <LogTable head={["When", "User", "Section", "Fails"]} numCols={[3]}>
          {data.recentFailures.map((f) => (
            <tr key={f.id}>
              <TimeCell d={f.updatedAt} />
              <UserCell name={f.name} discordId={f.discordId} />
              <td>{sectionLabel(f.section)}</td>
              <td className={`${styles.num} mono`}>{f.fails}</td>
            </tr>
          ))}
        </LogTable>
      </Panel>
    </>
  );
}

function HealthPanel({ data }: { data: ReturnType<typeof readHealth> }) {
  return (
    <>
      <Panel
        title="Feedback"
        count={data.recentFeedback.length}
        empty="No reports or suggestions yet."
      >
        <LogTable head={["When", "User", "Kind", "Page", "Message", "Sent"]}>
          {data.recentFeedback.map((f) => (
            <tr key={f.id}>
              <TimeCell d={f.createdAt} />
              <UserCell name={f.name} discordId={f.discordId} />
              <td>{f.kind === "bug" ? "🐛 bug" : "💡 idea"}</td>
              <td className="mono">{f.path}</td>
              <td className={styles.detail} title={f.message}>
                {f.message}
              </td>
              <td>
                <Pill tone={f.delivered ? "ok" : "warn"}>{f.delivered ? "sent" : "queued"}</Pill>
              </td>
            </tr>
          ))}
        </LogTable>
      </Panel>
    </>
  );
}

function Panel({
  title,
  count,
  empty,
  always,
  children,
}: {
  title: string;
  count?: number;
  empty?: string;
  /** Shown above the list even when it is empty (e.g. the filter bar). */
  always?: React.ReactNode;
  children: React.ReactNode;
}) {
  const isEmpty = count === 0;
  return (
    <div className={styles.block}>
      <h3 className={styles.blockTitle}>
        {title}
        {count != null && <span className={styles.count}> ({count})</span>}
      </h3>
      {always}
      {isEmpty && empty ? <p className={styles.empty}>{empty}</p> : children}
    </div>
  );
}

function LogTable({
  head,
  numCols = [],
  children,
}: {
  head: string[];
  /** 0-based indexes of header cells that should be right-aligned. */
  numCols?: number[];
  children: React.ReactNode;
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={numCols.includes(i) ? styles.num : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function TimeCell({ d }: { d: Date | string }) {
  return (
    <td className={`mono ${styles.timeCell}`} title={formatAdminTimeFull(d)}>
      {formatAdminTime(d)}
    </td>
  );
}

function UserCell({
  name,
  discordId,
}: {
  name: string | null;
  discordId: string;
}) {
  return (
    <td>
      <div className={styles.userCell}>
        <span>{name ?? "Unknown"}</span>
        <span className={`mono ${styles.userId}`} title={discordId}>
          {shortId(discordId)}
        </span>
      </div>
    </td>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad";
  children: React.ReactNode;
}) {
  return (
    <span
      className={`${styles.pill} ${
        tone === "ok" ? styles.pillOk : tone === "bad" ? styles.pillBad : styles.pillWarn
      }`}
    >
      {children}
    </span>
  );
}
