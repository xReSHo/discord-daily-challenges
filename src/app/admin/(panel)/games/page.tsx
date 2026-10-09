import { Power, Triangle } from "lucide-react";
import { Prisma } from "@prisma/client";
import { loadAdminPage } from "@/lib/admin-auth";
import { SECTIONS } from "@/lib/sections";
import { MAX_REWARD, TRIES, sectionStatusesFromRows, stateOf } from "@/lib/section-status";
import { parseGeodashEconomy } from "@/lib/site-settings";
import { getChallengeDate } from "@/lib/challenge-date";
import { saveGameAction, saveGeodashAction } from "@/app/admin/actions";
import { AdminShell, Field, readFlash } from "@/app/admin/ui";
import { SubmitButton } from "@/app/admin/controls";
import styles from "@/app/admin/admin.module.css";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;


type SearchParams = { [key: string]: string | string[] | undefined };

export default async function AdminGamesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // The admin check and everything this tab shows, in one round trip.
  const since = new Date(getChallengeDate().getTime() - 13 * DAY_MS);
  const { data } = await loadAdminPage({
    statuses: Prisma.sql`SELECT * FROM "SectionStatus"`,
    geodash: Prisma.sql`SELECT value FROM "SiteSetting" WHERE key = 'geodash'`,
    // Completions per game over the last 14 days — how much each game has
    // actually been played lately, the number to look at before switching one off.
    plays: Prisma.sql`
      SELECT section, count(*)::int AS n FROM "Completion"
      WHERE rewarded AND date >= ${since}::date GROUP BY section`,
  });
  const statuses = sectionStatusesFromRows(data.statuses);
  const geo = parseGeodashEconomy(data.geodash[0]?.value ?? null);
  const plays = new Map(data.plays.map((r) => [String(r.section), Number(r.n)]));

  return (
    <AdminShell
      title="Games"
      flash={readFlash(await searchParams)}
    >
      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Status &amp; rewards</h3>
        <p className={styles.panelNote}>
          Changes reach the live site within about 15 seconds. <strong>Closed</strong> keeps the
          game listed with your note; <strong>Hidden</strong> removes it and stops it counting
          toward a perfect day.
        </p>

        <div className={styles.cardList}>
          {statuses.map((s) => {
            const state = stateOf(s);
            const def = SECTIONS[s.section];
            const isGeo = s.section === "geodash";
            const tries = TRIES[s.section];
            return (
              <form
                key={s.section}
                action={saveGameAction}
                className={`${styles.card} ${state !== "open" ? styles.cardOff : ""}`}
              >
                <input type="hidden" name="section" value={s.section} />
                <div className={styles.cardHead}>
                  <span className={styles.cardTitle}>
                    <Power size={14} className={state === "open" ? styles.ok : styles.bad} />
                    {def.label}
                  </span>
                  <span className={styles.cardSub}>
                    {plays.get(s.section) ?? 0} completions in the last 14 days
                  </span>
                  <span
                    className={`${styles.pill} ${
                      state === "open"
                        ? styles.pillOk
                        : state === "closed"
                          ? styles.pillWarn
                          : styles.pillBad
                    }`}
                  >
                    {state}
                  </span>
                </div>

                <div className={styles.formGrid}>
                  <Field label="Status">
                    <select name="state" defaultValue={state} className={styles.input}>
                      <option value="open">Open — playable</option>
                      <option value="closed">Closed — listed, not playable</option>
                      <option value="hidden">Hidden — removed from the site</option>
                    </select>
                  </Field>

                  {isGeo ? (
                    <Field label="Reward" hint="Set in the Geometry Dash panel below.">
                      <input
                        className={styles.input}
                        value={`${geo.entry} entry`}
                        disabled
                        readOnly
                      />
                    </Field>
                  ) : (
                    <Field label="Reward (coins)" hint={`Blank = default (${def.reward}).`}>
                      <input
                        name="reward"
                        type="number"
                        min={0}
                        max={MAX_REWARD}
                        step={1}
                        defaultValue={s.reward ?? ""}
                        placeholder={String(def.reward)}
                        className={styles.input}
                      />
                    </Field>
                  )}

                  <Field label={tries.label} hint={`${tries.hint} Blank = default (${tries.fallback}).`}>
                    <input
                      name="tries"
                      type="number"
                      min={tries.min}
                      max={tries.max}
                      step={1}
                      defaultValue={s.tries ?? ""}
                      placeholder={String(tries.fallback)}
                      className={styles.input}
                    />
                  </Field>

                  <Field label="Note shown while closed" wide>
                    <input
                      name="note"
                      type="text"
                      maxLength={300}
                      defaultValue={s.note ?? ""}
                      placeholder="Optional — e.g. “Back tomorrow after a fix.”"
                      className={styles.input}
                    />
                  </Field>
                </div>

                <div className={styles.formActions}>
                  <SubmitButton>Save {def.label}</SubmitButton>
                </div>
              </form>
            );
          })}
        </div>
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Geometry Dash fees &amp; rewards</h3>
        <form action={saveGeodashAction} className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>
              <Triangle size={14} /> Staked run
            </span>
            <span className={styles.cardSub}>
              Easy, Medium and Hard charge the entry fee and pay it back plus the
              reward. Impossible pays the player&apos;s own stake times the
              multiplier.
            </span>
          </div>
          <div className={styles.formGrid}>
            <Field label="Entry fee">
              <input name="entry" type="number" min={0} step={1} required defaultValue={geo.entry} className={styles.input} />
            </Field>
            <Field label="Easy reward">
              <input name="easy" type="number" min={0} step={1} required defaultValue={geo.rewards.easy} className={styles.input} />
            </Field>
            <Field label="Medium reward">
              <input name="medium" type="number" min={0} step={1} required defaultValue={geo.rewards.medium} className={styles.input} />
            </Field>
            <Field label="Hard reward">
              <input name="hard" type="number" min={0} step={1} required defaultValue={geo.rewards.hard} className={styles.input} />
            </Field>
            <Field label="Impossible minimum stake">
              <input name="impossibleMin" type="number" min={1} step={1} required defaultValue={geo.impossibleMin} className={styles.input} />
            </Field>
            <Field label="Impossible multiplier">
              <input name="impossibleMult" type="number" min={1} max={100} step={1} required defaultValue={geo.impossibleMult} className={styles.input} />
            </Field>
          </div>
          <div className={styles.formActions}>
            <SubmitButton>Save Geometry Dash</SubmitButton>
          </div>
        </form>
      </div>
    </AdminShell>
  );
}
