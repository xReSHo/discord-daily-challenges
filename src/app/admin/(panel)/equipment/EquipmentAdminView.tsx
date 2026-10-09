import { Dices, PackageOpen, RefreshCw } from "lucide-react";
import type { EquipmentAdminData } from "@/lib/admin-games-data";
import { DROP_ODDS_CAP, DROP_ROLLS, type DropRoll } from "@/lib/site-settings";
import { RARITIES, getPiece, type Odds, type Rarity } from "@/lib/equipment";
import { formatAdminTime, formatAdminTimeFull } from "@/lib/challenge-date";
import { payDuplicatesAction, saveCrateAction, saveDropsAction } from "@/app/admin/actions";
import { emptyChance, repeatReturn } from "@/lib/crate";
import { Field } from "@/app/admin/ui";
import { SubmitButton } from "@/app/admin/controls";
import styles from "@/app/admin/admin.module.css";

const coins = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number) => `${Number(n.toFixed(2))}%`;
const total = (odds: Odds) => Object.values(odds).reduce((sum, v) => sum + (v ?? 0), 0);

/** "about 1 in 5", for a chance in percent. */
function oneIn(chance: number | undefined): string {
  if (!chance || chance <= 0) return "Never.";
  const n = 100 / chance;
  return `About 1 in ${n >= 10 ? Math.round(n).toLocaleString("en-US") : Number(n.toFixed(1))}.`;
}

/** "trial:wordle:2026-10-09" → "Wordle trial", "boss:abc" → "Boss raid". */
function sourceLabel(source: string): string {
  const [kind, what] = source.split(":");
  if (kind === "boss") return "Boss raid";
  if (kind === "crate") return "Crate";
  if (kind === "trial") return `${what ? what[0].toUpperCase() + what.slice(1) : "A"} trial`;
  return source;
}

/** Everything on the Equipment tab, from data already read. */
export function EquipmentAdminView({ data }: { data: EquipmentAdminData }) {
  const { settings: s, crate, crateWeek, week, owed, owners, recent } = data;
  const crateBack = repeatReturn(crate);
  const share = week.trialsDone > 0 ? (week.trial / week.trialsDone) * 100 : null;

  return (
    <>
      <section className={styles.figures}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{week.trial.toLocaleString("en-US")}</span>
          <span className={styles.statLabel}>
            Found in trials, 7 days{share != null ? ` (${pct(share)} of ${week.trialsDone})` : ""}
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{week.boss.toLocaleString("en-US")}</span>
          <span className={styles.statLabel}>Found in raids, 7 days</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{coins(week.coinsPaid)}</span>
          <span className={styles.statLabel}>Coins paid for {week.repeats} repeat finds</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{owners.pieces.toLocaleString("en-US")}</span>
          <span className={styles.statLabel}>Pieces owned by {owners.players} players</span>
        </div>
      </section>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Drops</h3>
        <p className={styles.panelNote}>
          Changes reach the live site within about 15 seconds and show in every game&apos;s Spoils panel.
          Switching drops off never touches a trial&apos;s coins or a raid&apos;s bounty, and nothing
          already found is taken away.
        </p>
        <form action={saveDropsAction} className={`${styles.card} ${s.trials || s.bosses ? "" : styles.cardOff}`}>
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>
              <Dices size={14} /> Equipment drops
            </span>
            <span className={`${styles.pill} ${s.trials && s.bosses ? styles.pillOk : s.trials || s.bosses ? styles.pillWarn : styles.pillBad}`}>
              {s.trials && s.bosses ? "on" : s.trials ? "trials only" : s.bosses ? "raids only" : "off"}
            </span>
          </div>

          <div className={styles.checks}>
            <label className={styles.check}>
              <input name="trials" type="checkbox" defaultChecked={s.trials} /> Finished trials roll for
              equipment
            </label>
            <label className={styles.check}>
              <input name="bosses" type="checkbox" defaultChecked={s.bosses} /> Slain bosses roll for
              equipment
            </label>
          </div>

          {(Object.keys(DROP_ROLLS) as DropRoll[]).map((roll) => (
            <fieldset key={roll} className={styles.group}>
              <legend className={styles.groupTitle}>
                {DROP_ROLLS[roll].label} — the chance of each rarity. Together now {pct(total(s[roll]))}, so{" "}
                {pct(100 - total(s[roll]))} of rolls find nothing. The total may not pass {DROP_ODDS_CAP}%.
              </legend>
              <div className={styles.formGrid}>
                {(Object.keys(DROP_ROLLS[roll].base) as Rarity[]).map((rarity) => (
                  <Field
                    key={rarity}
                    label={`${RARITIES.find((r) => r.id === rarity)?.name ?? rarity} chance`}
                    hint={`${oneIn(s[roll][rarity])} Default ${DROP_ROLLS[roll].base[rarity]}%.`}
                  >
                    <span className={styles.unit} data-unit="%">
                      <input
                        name={`${roll}.${rarity}`}
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        required
                        defaultValue={s[roll][rarity] ?? 0}
                        className={styles.input}
                      />
                    </span>
                  </Field>
                ))}
              </div>
            </fieldset>
          ))}

          <fieldset className={styles.group}>
            <legend className={styles.groupTitle}>
              Coins paid when a piece already owned is found again
            </legend>
            <div className={styles.formGrid}>
              {RARITIES.map((r) => (
                <Field key={r.id} label={`${r.name} repeat`}>
                  <span className={styles.unit} data-unit="coins">
                    <input
                      name={`coins.${r.id}`}
                      type="number"
                      min={0}
                      step={1}
                      required
                      defaultValue={s.duplicateCoins[r.id]}
                      className={styles.input}
                    />
                  </span>
                </Field>
              ))}
            </div>
          </fieldset>

          <div className={styles.formActions}>
            <SubmitButton>Save drops</SubmitButton>
          </div>
        </form>
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>The crate</h3>
        <p className={styles.panelNote}>
          Sold in the shop; one roll for a piece of any rarity, or nothing. In the last 7 days:{" "}
          <strong>{crateWeek.opened.toLocaleString("en-US")}</strong> opened for{" "}
          <strong>{coins(crateWeek.spent)}</strong> coins, giving{" "}
          <strong>{crateWeek.pieces.toLocaleString("en-US")}</strong> new pieces and{" "}
          <strong>{coins(crateWeek.paidBack)}</strong> coins back for repeats.
        </p>
        <form action={saveCrateAction} className={`${styles.card} ${crate.open ? "" : styles.cardOff}`}>
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>
              <PackageOpen size={14} /> The Reliquary
            </span>
            <span className={styles.cardSub}>
              {pct(emptyChance(crate.odds))} of crates are empty · a player who owns everything gets back about{" "}
              {coins(crateBack)} of every {coins(crate.price)} spent
            </span>
            <span className={`${styles.pill} ${crate.open ? styles.pillOk : styles.pillBad}`}>
              {crate.open ? "on sale" : "off"}
            </span>
          </div>

          <div className={styles.formGrid}>
            <label className={styles.check}>
              <input name="open" type="checkbox" defaultChecked={crate.open} /> On sale
            </label>
            <Field label="Price">
              <span className={styles.unit} data-unit="coins">
                <input name="price" type="number" min={1} step={1} required defaultValue={crate.price} className={styles.input} />
              </span>
            </Field>
          </div>

          <fieldset className={styles.group}>
            <legend className={styles.groupTitle}>
              What a crate holds — the six chances must add up to exactly 100%
            </legend>
            <div className={styles.formGrid}>
              <Field label="Empty (nothing) chance" hint={oneIn(emptyChance(crate.odds))}>
                <span className={styles.unit} data-unit="%">
                  <input
                    name="odds.empty"
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    required
                    defaultValue={emptyChance(crate.odds)}
                    className={styles.input}
                  />
                </span>
              </Field>
              {RARITIES.map((r) => (
                <Field key={r.id} label={`${r.name} chance`} hint={oneIn(crate.odds[r.id])}>
                  <span className={styles.unit} data-unit="%">
                    <input
                      name={`odds.${r.id}`}
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      required
                      defaultValue={crate.odds[r.id]}
                      className={styles.input}
                    />
                  </span>
                </Field>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.group}>
            <legend className={styles.groupTitle}>
              Coins paid when the piece inside is already owned — set against the price: below it is a
              loss for the player, above it a gain
            </legend>
            <div className={styles.formGrid}>
              {RARITIES.map((r) => (
                <Field
                  key={r.id}
                  label={`${r.name} repeat`}
                  hint={
                    crate.refund[r.id] > crate.price
                      ? `${coins(crate.refund[r.id] - crate.price)} more than the price.`
                      : crate.refund[r.id] < crate.price
                        ? `${coins(crate.price - crate.refund[r.id])} less than the price.`
                        : "The same as the price."
                  }
                >
                  <span className={styles.unit} data-unit="coins">
                    <input
                      name={`refund.${r.id}`}
                      type="number"
                      min={0}
                      step={1}
                      required
                      defaultValue={crate.refund[r.id]}
                      className={styles.input}
                    />
                  </span>
                </Field>
              ))}
            </div>
          </fieldset>

          <p className={styles.panelNote}>
            A save is refused if a player who owns everything would get back, on average, as much as the crate
            costs — that would let crates be opened for profit.
          </p>
          <div className={styles.formActions}>
            <SubmitButton>Save the crate</SubmitButton>
          </div>
        </form>
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>
          Repeat-find payments <span className={styles.count}>({owed.n} owed)</span>
        </h3>
        {owed.n === 0 ? (
          <p className={styles.empty}>Every repeat find has been paid.</p>
        ) : (
          <form action={payDuplicatesAction} className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.cardTitle}>
                <RefreshCw size={14} className={styles.warn} /> {owed.n} repeat{" "}
                {owed.n === 1 ? "find is" : "finds are"} owed {coins(owed.coins)} coins
              </span>
              <span className={styles.cardSub}>
                Each is retried by itself at that player&apos;s next roll. This sends them all now; nothing
                is ever paid twice.
              </span>
            </div>
            <div className={styles.formActions}>
              <SubmitButton busy="Sending…">Pay owed coins now</SubmitButton>
            </div>
          </form>
        )}
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>
          Recent finds <span className={styles.count}>({recent.length})</span>
        </h3>
        {recent.length === 0 ? (
          <p className={styles.empty}>Nothing has been found yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Player</th>
                  <th>From</th>
                  <th>Piece</th>
                  <th>Rarity</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((d) => {
                  const piece = getPiece(d.pieceId);
                  return (
                    <tr key={d.id}>
                      <td className={`mono ${styles.timeCell}`} title={formatAdminTimeFull(d.createdAt)}>
                        {formatAdminTime(d.createdAt)}
                      </td>
                      <td>
                        <div className={styles.userCell}>
                          <span>{d.name ?? "Unknown"}</span>
                          <span className={`mono ${styles.userId}`}>{d.discordId}</span>
                        </div>
                      </td>
                      <td>{sourceLabel(d.source)}</td>
                      <td>{piece?.name ?? d.pieceId}</td>
                      <td>{piece ? (RARITIES.find((r) => r.id === piece.rarity)?.name ?? piece.rarity) : "—"}</td>
                      <td>
                        {d.duplicate ? (
                          <span className={`${styles.pill} ${d.coinsPaid ? styles.pillOk : styles.pillBad}`}>
                            repeat · {coins(d.coins)} {d.coinsPaid ? "paid" : "OWED"}
                          </span>
                        ) : (
                          <span className={`${styles.pill} ${styles.pillOk}`}>new piece</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
