import { Plus } from "lucide-react";
import { Prisma } from "@prisma/client";
import { loadAdminPage } from "@/lib/admin-auth";
import { AchievementIcon, rewardLine, triggerLine } from "@/lib/achievements/catalog";
import { achievementDefsFromRows, getAllAchievementDefs } from "@/lib/achievements/store";
import { deleteAchievementAction, saveAchievementAction } from "@/app/admin/actions";
import { AdminShell, readFlash } from "@/app/admin/ui";
import { AchievementFields } from "./AchievementFields";
import { SubmitButton } from "@/app/admin/controls";
import styles from "@/app/admin/admin.module.css";

export const dynamic = "force-dynamic";

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function AdminAchievementsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // The admin check and everything this tab shows, in one round trip.
  const { data } = await loadAdminPage({
    defs: Prisma.sql`SELECT * FROM "AchievementDef" ORDER BY "sortOrder" ASC, "createdAt" ASC`,
    held: Prisma.sql`
      SELECT key, count(*)::int AS held,
        (count(*) FILTER (WHERE NOT "rewardGranted"))::int AS unpaid
      FROM "Achievement" GROUP BY key`,
  });
  // An empty table has never been seeded — the store does that on first read.
  const defs = data.defs.length
    ? achievementDefsFromRows(data.defs)
    : await getAllAchievementDefs();
  const heldBy = new Map(data.held.map((r) => [String(r.key), Number(r.held)]));
  const unpaidBy = new Map(
    data.held.filter((r) => Number(r.unpaid) > 0).map((r) => [String(r.key), Number(r.unpaid)]),
  );

  return (
    <AdminShell
      title="Achievements"
      flash={readFlash(await searchParams)}
    >
      <div className={styles.block}>
        <h3 className={styles.blockTitle}>
          Achievements <span className={styles.count}>({defs.length})</span>
        </h3>
        <p className={styles.panelNote}>
          Progress counts from the achievements launch date onward, so a new
          achievement unlocks — and pays — for anyone who already qualifies the
          next time they finish a game. Editing a reward never re-pays people who
          already hold it; a permanent boost follows its current percent.
        </p>

        <div className={styles.cardList}>
          {defs.map((def) => {
            const holders = heldBy.get(def.key) ?? 0;
            const owed = unpaidBy.get(def.key) ?? 0;
            return (
              <details key={def.key} className={`${styles.card} ${def.enabled ? "" : styles.cardOff}`}>
                <summary className={styles.cardHead}>
                  <span className={styles.cardTitle}>
                    <AchievementIcon name={def.icon} size={15} /> {def.name}
                  </span>
                  <span className={styles.cardSub}>
                    {triggerLine(def.trigger)} → {rewardLine(def.reward)} · held by {holders}
                    {owed > 0 ? ` · ${owed} reward${owed === 1 ? "" : "s"} not delivered yet` : ""}
                  </span>
                  <span className={`${styles.pill} ${def.enabled ? styles.pillOk : styles.pillBad}`}>
                    {def.enabled ? "live" : "off"}
                  </span>
                </summary>
                <form action={saveAchievementAction}>
                  <AchievementFields def={def} />
                  <div className={styles.formActions}>
                    <SubmitButton>Save achievement</SubmitButton>
                  </div>
                </form>
                {holders === 0 && (
                  <form action={deleteAchievementAction} className={styles.formActions}>
                    <input type="hidden" name="key" value={def.key} />
                    <SubmitButton tone="danger" busy="Deleting…" confirm="Delete this achievement? This can't be undone.">
                    Delete achievement
                  </SubmitButton>
                  </form>
                )}
              </details>
            );
          })}

          <details className={styles.card}>
            <summary className={styles.cardHead}>
              <span className={styles.cardTitle}>
                <Plus size={14} /> Add an achievement
              </span>
            </summary>
            <form action={saveAchievementAction}>
              <AchievementFields />
              <div className={styles.formActions}>
                <SubmitButton>Add achievement</SubmitButton>
              </div>
            </form>
          </details>
        </div>
      </div>
    </AdminShell>
  );
}
