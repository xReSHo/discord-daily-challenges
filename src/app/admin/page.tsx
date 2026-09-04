import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ShieldAlert,
  CircleCheck,
  ShoppingBag,
  Swords,
  Triangle,
  Bot,
  Coins,
  Power,
} from "lucide-react";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { AppFrame } from "@/components/AppFrame";
import {
  getAdminOverview,
  type AdminOverview,
  type AdminFilters,
} from "@/lib/admin-data";
import {
  getChallengeDateString,
  formatAdminTime,
  formatAdminTimeFull,
} from "@/lib/challenge-date";
import { SECTIONS, isSectionId } from "@/lib/sections";
import { getAllSectionStatuses } from "@/lib/section-status";
import { logger } from "@/lib/logger";
import { toggleSection } from "./section-actions";
import { AdminTabs, type AdminTab } from "./AdminTabs";
import styles from "./admin.module.css";

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

  const sectionStatuses = await getAllSectionStatuses().catch(() => []);
  const gamesOffline = sectionStatuses.filter((s) => s.disabled).length;

  return (
    <AppFrame back={{ href: "/dashboard", label: "Back to trials" }}>
      <div className="container">
        <header className={`${styles.head} rise`}>
          <p className="eyebrow">Warden&apos;s Ledger</p>
          <h1 className={styles.title}>Admin</h1>
          <p className={styles.meta}>
            <span className="mono">{getChallengeDateString()}</span>
            <span className={styles.sep} />
            <span>times in Bahrain</span>
            <span className={styles.sep} />
            <Link href="/admin/boss" className={styles.bossLink}>
              <Swords size={13} /> Boss control
            </Link>
          </p>
        </header>

        {!data && (
          <p className={styles.empty}>
            Couldn&apos;t load the ledger
            {loadError ? ` — ${loadError}` : ""}. If this is the first deploy, run{" "}
            <code>npx prisma db push</code> to create the audit tables.
          </p>
        )}

        {data && (
          <AdminBody
            data={data}
            filters={filters}
            hasFilters={hasFilters}
            sectionStatuses={sectionStatuses}
            gamesOffline={gamesOffline}
          />
        )}
      </div>
    </AppFrame>
  );
}

// ---------------------------------------------------------------------------

type Tone = "warn" | "bad";

function AdminBody({
  data,
  filters,
  hasFilters,
  sectionStatuses,
  gamesOffline,
}: {
  data: AdminOverview;
  filters: AdminFilters;
  hasFilters: boolean;
  sectionStatuses: { section: string; disabled: boolean; note: string | null }[];
  gamesOffline: number;
}) {
  // Every alert routes to the tab that lets you act on it.
  const alerts: { label: string; count: number; tab: string; tone: Tone }[] = [
    { label: "Flags (7d)", count: data.flags7d, tab: "integrity", tone: "bad" },
    { label: "Challenge fails today", count: data.failuresToday, tab: "integrity", tone: "warn" },
    { label: "GeoDash to review", count: data.geoReviewCount, tab: "economy", tone: "bad" },
    { label: "Purchases stuck", count: data.purchasesUnfulfilled, tab: "economy", tone: "warn" },
    { label: "Unpaid completions", count: data.unpaidCompletions, tab: "activity", tone: "bad" },
    { label: "Feedback queued", count: data.feedbackUndelivered, tab: "health", tone: "warn" },
    { label: "Assistant fails (7d)", count: data.chatIncidents7d, tab: "health", tone: "warn" },
    { label: "Games offline", count: gamesOffline, tab: "controls", tone: "warn" },
  ];
  const live = alerts.filter((a) => a.count > 0);
  const badge = (tab: string) =>
    alerts.filter((a) => a.tab === tab).reduce((n, a) => n + a.count, 0) || undefined;

  const tabs: AdminTab[] = [
    {
      id: "activity",
      label: "Activity",
      badge: badge("activity"),
      panel: (
        <>
          <Panel
            title="Recent completions"
            count={data.recentCompletions.length}
            empty={
              hasFilters
                ? "No completions match those filters."
                : "No completions recorded yet."
            }
          >
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

            {data.recentCompletions.length > 0 && (
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
                      <Pill tone={c.rewarded ? "ok" : "bad"}>
                        {c.rewarded ? "paid" : "FAILED"}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </LogTable>
            )}
          </Panel>

          <Panel title="Today by section" count={data.todayBySection.length} empty="No completions yet today.">
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
      ),
    },
    {
      id: "economy",
      label: "Economy",
      badge: badge("economy"),
      panel: (
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
                    <Pill
                      tone={
                        g.status === "won"
                          ? "ok"
                          : g.status === "rejected"
                            ? "bad"
                            : "warn"
                      }
                    >
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
      ),
    },
    {
      id: "integrity",
      label: "Integrity",
      badge: badge("integrity"),
      panel: (
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
                  <td
                    className={`mono ${styles.detail}`}
                    title={JSON.stringify(f.detail)}
                  >
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
      ),
    },
    {
      id: "health",
      label: "Support & health",
      badge: badge("health"),
      panel: (
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
                    <Pill tone={f.delivered ? "ok" : "warn"}>
                      {f.delivered ? "sent" : "queued"}
                    </Pill>
                  </td>
                </tr>
              ))}
            </LogTable>
          </Panel>

          <Panel
            title="Assistant incidents"
            count={data.recentChatIncidents.length}
            empty="No assistant failures — the chatbot has been reaching its model fine."
          >
            <LogTable head={["When", "User", "Reason", "Detail", "Owner DM'd"]}>
              {data.recentChatIncidents.map((c) => (
                <tr key={c.id}>
                  <TimeCell d={c.createdAt} />
                  <UserCell name={c.name} discordId={c.discordId} />
                  <td className="mono">{c.reason}</td>
                  <td className={styles.detail} title={c.detail ?? ""}>
                    {c.detail ?? "—"}
                  </td>
                  <td>
                    <Pill tone={c.notified ? "ok" : "warn"}>
                      {c.notified ? "yes" : "throttled"}
                    </Pill>
                  </td>
                </tr>
              ))}
            </LogTable>
          </Panel>
        </>
      ),
    },
    {
      id: "controls",
      label: "Controls",
      badge: badge("controls"),
      panel: (
        <Panel title="Game status" count={sectionStatuses.length}>
          <p className={styles.panelNote}>
            Take a game offline when a critical bug is found — its page shows a
            notice and its play/submit endpoints return an error. The note is
            shown to players.
          </p>
          <div className={styles.gameList}>
            {sectionStatuses.map((s) => (
              <form
                key={s.section}
                action={toggleSection}
                className={`${styles.gameRow} ${s.disabled ? styles.gameRowOff : ""}`}
              >
                <input type="hidden" name="section" value={s.section} />
                <span className={styles.gameName}>
                  <Power
                    size={13}
                    className={s.disabled ? styles.bad : styles.ok}
                  />
                  {sectionLabel(s.section)}
                </span>
                <label className={styles.gameState}>
                  <input
                    type="checkbox"
                    name="disabled"
                    defaultChecked={s.disabled}
                  />{" "}
                  Offline
                </label>
                <input
                  type="text"
                  name="note"
                  defaultValue={s.note ?? ""}
                  placeholder="Player-facing note (optional)"
                  maxLength={300}
                  className={`${styles.filterInput} ${styles.gameNote}`}
                />
                <button type="submit" className={styles.gameBtn}>
                  Save
                </button>
              </form>
            ))}
          </div>
          <p className={styles.panelNote}>
            <Link href="/admin/boss" className={styles.bossLink}>
              <Swords size={13} /> Weekly boss control &amp; schedule →
            </Link>
          </p>
        </Panel>
      ),
    },
  ];

  return (
    <>
      <section className={`${styles.attention} rise`}>
        {live.length === 0 ? (
          <p className={styles.allClear}>
            <CircleCheck size={16} /> All clear — nothing needs attention.
          </p>
        ) : (
          <div className={styles.alertRow}>
            {live.map((a) => (
              <span
                key={a.label}
                className={`${styles.alert} ${a.tone === "bad" ? styles.alertBad : styles.alertWarn}`}
              >
                <span className={styles.alertNum}>{a.count.toLocaleString()}</span>
                <span className={styles.alertLabel}>{a.label}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className={`${styles.todayRow} stagger`}>
        <MiniStat
          icon={<CircleCheck size={16} />}
          label="Completions today"
          value={data.todayTotals.count}
        />
        <MiniStat
          icon={<Coins size={16} />}
          label="Paid out today"
          value={data.todayTotals.paidOut}
        />
        <MiniStat
          icon={<ShieldAlert size={16} />}
          label="Flags · 7 days"
          value={data.flags7d}
          tone={data.flags7d > 0 ? "warn" : undefined}
        />
        <MiniStat
          icon={<Triangle size={16} />}
          label="GeoDash to review"
          value={data.geoReviewCount}
          tone={data.geoReviewCount > 0 ? "bad" : undefined}
        />
        <MiniStat
          icon={<ShoppingBag size={16} />}
          label="Purchases stuck"
          value={data.purchasesUnfulfilled}
          tone={data.purchasesUnfulfilled > 0 ? "warn" : undefined}
        />
        <MiniStat
          icon={<Bot size={16} />}
          label="Assistant fails · 7d"
          value={data.chatIncidents7d}
          tone={data.chatIncidents7d > 0 ? "warn" : undefined}
        />
      </section>

      <AdminTabs tabs={tabs} />
    </>
  );
}

// ---------------------------------------------------------------------------

function MiniStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: Tone;
}) {
  return (
    <div className={`panel ${styles.miniStat}`}>
      <span className={styles.miniIcon}>{icon}</span>
      <span
        className={`${styles.miniValue} ${
          tone === "warn" ? styles.warn : tone === "bad" ? styles.bad : ""
        }`}
      >
        {value.toLocaleString()}
      </span>
      <span className={styles.miniLabel}>{label}</span>
    </div>
  );
}

function Panel({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count?: number;
  empty?: string;
  children: React.ReactNode;
}) {
  const isEmpty = count === 0;
  return (
    <div className={styles.block}>
      <h3 className={styles.blockTitle}>
        {title}
        {count != null && <span className={styles.count}> ({count})</span>}
      </h3>
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
