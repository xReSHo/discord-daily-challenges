import { Power, RefreshCw, Sword, Undo2 } from "lucide-react";
import type { PitAdminData } from "@/lib/admin-games-data";
import { PIT_MAX_CUT } from "@/lib/site-settings";
import { CPU, CPU_NAME } from "@/lib/duel/game";
import { cutFor, rankOf } from "@/lib/duel/rules";
import { formatAdminTime, formatAdminTimeFull } from "@/lib/challenge-date";
import {
  pitReopenAction,
  pitSettleAction,
  pitStandingAction,
  pitWithdrawAction,
  pitWithdrawAllAction,
  savePitAction,
} from "@/app/admin/actions";
import { Field } from "@/app/admin/ui";
import { SubmitButton } from "@/app/admin/controls";
import styles from "@/app/admin/admin.module.css";

const coins = (n: number) => Math.round(n).toLocaleString("en-US");

function Who({ name, id }: { name: string | null; id: string | null }) {
  if (id === CPU) return <td>{CPU_NAME}</td>;
  return (
    <td>
      <div className={styles.userCell}>
        <span>{name ?? "Unknown"}</span>
        <span className={`mono ${styles.userId}`}>{id ?? "—"}</span>
      </div>
    </td>
  );
}

function When({ at }: { at: string }) {
  if (!at) return <td>—</td>;
  return (
    <td className={`mono ${styles.timeCell}`} title={formatAdminTimeFull(at)}>
      {formatAdminTime(at)}
    </td>
  );
}

/** Everything on the Pit tab, from data already read. */
export function PitView({ data }: { data: PitAdminData }) {
  const { settings: s, week, waiting, recent, top } = data;
  const taking = s.open && (s.cpu || s.players);
  const stuck = waiting.filter((w) => w.status === "locked");
  const open = waiting.filter((w) => w.status === "open");

  return (
    <>
      <section className={styles.figures}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{week.duels.toLocaleString("en-US")}</span>
          <span className={styles.statLabel}>Duels, last 7 days</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{coins(week.staked)}</span>
          <span className={styles.statLabel}>Coins staked</span>
        </div>
        <div className={styles.stat}>
          <span className={`${styles.statValue} ${week.house < 0 ? styles.bad : ""}`}>
            {week.house < 0 ? "−" : "+"}
            {coins(Math.abs(week.house))}
          </span>
          <span className={styles.statLabel}>Champion won or lost ({week.cpuDuels} duels)</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{coins(week.rake)}</span>
          <span className={styles.statLabel}>Cut kept from player duels</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{coins(week.biggest)}</span>
          <span className={styles.statLabel}>Largest stake</span>
        </div>
      </section>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Status &amp; terms</h3>
        <p className={styles.panelNote}>
          Changes reach the live site within about 15 seconds. Closing the pit, or switching off duels
          between players, withdraws every waiting challenge and returns its stake. A duel already fought
          is never changed.
        </p>
        <form action={savePitAction} className={`${styles.card} ${taking ? "" : styles.cardOff}`}>
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>
              <Power size={14} className={taking ? styles.ok : styles.bad} /> The pit is{" "}
              {s.open ? "open" : "closed"}
            </span>
            <span className={styles.cardSub}>
              The champion {s.open && s.cpu ? "takes duels" : "is off"} · players{" "}
              {s.open && s.players ? "can challenge each other" : "cannot challenge each other"}
            </span>
            <span className={`${styles.pill} ${s.open ? styles.pillOk : styles.pillBad}`}>
              {s.open ? "open" : "closed"}
            </span>
          </div>

          <div className={styles.checks}>
            <label className={styles.check}>
              <input name="open" type="checkbox" defaultChecked={s.open} /> Open — the whole pit. Off
              shows players a closed notice.
            </label>
            <label className={styles.check}>
              <input name="cpu" type="checkbox" defaultChecked={s.cpu} /> Duels against the champion
              (the CPU)
            </label>
            <label className={styles.check}>
              <input name="players" type="checkbox" defaultChecked={s.players} /> Duels between players
              (and their rank)
            </label>
          </div>

          <div className={styles.formGrid}>
            <Field
              label="The pit's cut"
              hint={`Kept from the winner's pot. A legendary sword brings ${s.cut}% down to ${cutFor(5, s.cut)}%. At 0 the champion can be played for free.`}
            >
              <span className={styles.unit} data-unit="%">
                <input
                  name="cut"
                  type="number"
                  min={0}
                  max={PIT_MAX_CUT}
                  step={0.5}
                  required
                  defaultValue={s.cut}
                  className={styles.input}
                />
              </span>
            </Field>
            <Field label="Smallest stake">
              <input name="minStake" type="number" min={1} step={1} required defaultValue={s.minStake} className={styles.input} />
            </Field>
            <Field label="Largest stake" hint="Any duel. Blank or 0 = no limit.">
              <input name="maxStake" type="number" min={0} step={1} defaultValue={s.maxStake || ""} placeholder="No limit" className={styles.input} />
            </Field>
            <Field
              label="Largest stake against the champion"
              hint="The champion pays from nowhere, so this caps what one duel can mint. Blank or 0 = no limit."
            >
              <input name="cpuMaxStake" type="number" min={0} step={1} defaultValue={s.cpuMaxStake || ""} placeholder="No limit" className={styles.input} />
            </Field>
            <Field label="Challenges a player may have waiting">
              <input name="maxOpen" type="number" min={1} max={10} step={1} required defaultValue={s.maxOpen} className={styles.input} />
            </Field>
            <Field label="Note shown while closed" wide>
              <input
                name="note"
                maxLength={300}
                defaultValue={s.note ?? ""}
                placeholder="Optional — e.g. “The pit reopens tomorrow.”"
                className={styles.input}
              />
            </Field>
          </div>
          <div className={styles.formActions}>
            <SubmitButton>Save the pit</SubmitButton>
          </div>
        </form>
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>
          Payments <span className={styles.count}>({data.owed} owed)</span>
        </h3>
        {data.owed === 0 ? (
          <p className={styles.empty}>Every decided duel has been paid.</p>
        ) : (
          <form action={pitSettleAction} className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.cardTitle}>
                <RefreshCw size={14} className={styles.warn} /> {data.owed}{" "}
                {data.owed === 1 ? "duel has" : "duels have"} a payment that did not go through
              </span>
              <span className={styles.cardSub}>
                Each is retried by itself the next time that player opens the pit. This sends them all
                now; nothing is ever paid twice.
              </span>
            </div>
            <div className={styles.formActions}>
              <SubmitButton busy="Sending…">Send owed payments now</SubmitButton>
            </div>
          </form>
        )}
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>
          Waiting challenges <span className={styles.count}>({waiting.length})</span>
        </h3>
        {waiting.length === 0 ? (
          <p className={styles.empty}>No challenge is waiting for an answer.</p>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Posted</th>
                    <th>Challenger</th>
                    <th className={styles.num}>Stake</th>
                    <th>State</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {waiting.map((w) => (
                    <tr key={w.id}>
                      <When at={w.createdAt} />
                      <Who name={w.name} id={w.challengerId} />
                      <td className={`${styles.num} mono`}>{coins(w.stake)}</td>
                      <td>
                        <span className={`${styles.pill} ${w.status === "open" ? styles.pillOk : styles.pillWarn}`}>
                          {w.status === "open" ? "waiting" : "being answered"}
                        </span>
                      </td>
                      <td>
                        {w.status === "open" ? (
                          <form action={pitWithdrawAction}>
                            <input type="hidden" name="id" value={w.id} />
                            <SubmitButton
                              tone="plain"
                              busy="Refunding…"
                              confirm="Withdraw this challenge and return the stake to its challenger?"
                            >
                              <Undo2 size={11} /> Withdraw &amp; refund
                            </SubmitButton>
                          </form>
                        ) : (
                          <form action={pitReopenAction}>
                            <input type="hidden" name="id" value={w.id} />
                            <SubmitButton
                              tone="plain"
                              busy="Reopening…"
                              confirm="Only do this if it has said “being answered” for several minutes. Put the challenge back up?"
                            >
                              Put back up
                            </SubmitButton>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {stuck.length > 0 && (
              <p className={styles.panelNote}>
                “Being answered” lasts a second or two. One that stays that way was cut off mid-duel: put it
                back up, then withdraw it if you want its stake returned.
              </p>
            )}
            {open.length > 0 && (
              <form action={pitWithdrawAllAction} className={styles.formActions}>
                <SubmitButton
                  tone="danger"
                  busy="Refunding…"
                  confirm={`Withdraw all ${open.length} waiting challenges and return every stake?`}
                >
                  Withdraw every challenge
                </SubmitButton>
              </form>
            )}
          </>
        )}
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>
          Recent duels <span className={styles.count}>({recent.length})</span>
        </h3>
        {recent.length === 0 ? (
          <p className={styles.empty}>No duel has been fought yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Challenger</th>
                  <th>Opponent</th>
                  <th className={styles.num}>Stake</th>
                  <th>Result</th>
                  <th className={styles.num}>Paid to winner</th>
                  <th className={styles.num}>Cut</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((d) => (
                  <tr key={d.id}>
                    <When at={d.resolvedAt} />
                    <Who name={d.nameC} id={d.challengerId} />
                    <Who name={d.nameO} id={d.opponentId} />
                    <td className={`${styles.num} mono`}>{coins(d.stake)}</td>
                    <td>
                      {d.winner === "draw"
                        ? "Draw"
                        : d.winner === "challenger"
                          ? "Challenger won"
                          : "Opponent won"}{" "}
                      <span className="mono">
                        {d.scoreC}–{d.scoreO}
                      </span>
                    </td>
                    <td className={`${styles.num} mono`}>{d.payout ? coins(d.payout) : "—"}</td>
                    <td className={`${styles.num} mono`}>{d.rake ? coins(d.rake) : "—"}</td>
                    <td>
                      <span className={`${styles.pill} ${d.paid ? styles.pillOk : styles.pillBad}`}>
                        {d.paid ? "paid" : "OWED"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>
          Standings <span className={styles.count}>(top {top.length})</span>
        </h3>
        {top.length === 0 ? (
          <p className={styles.empty}>Nobody has a standing yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Rank</th>
                  <th className={styles.num}>Standing</th>
                  <th className={styles.num}>Peak</th>
                  <th>Against players</th>
                  <th>Against the champion</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r) => (
                  <tr key={r.discordId}>
                    <Who name={r.name} id={r.discordId} />
                    <td>{rankOf(r.mmr).name}</td>
                    <td className={`${styles.num} mono`}>{r.mmr}</td>
                    <td className={`${styles.num} mono`}>{r.peak}</td>
                    <td className="mono">
                      {r.wins}W {r.losses}L {r.draws}D
                    </td>
                    <td className="mono">
                      {r.cpuWins}W {r.cpuLosses}L
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form action={pitStandingAction} className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>
              <Sword size={14} /> Set a player&apos;s standing
            </span>
            <span className={styles.cardSub}>
              For undoing rank won by two players trading wins. Everyone starts at 1000; achievements
              already earned are kept.
            </span>
          </div>
          <div className={styles.formGrid}>
            <Field label="Discord user ID">
              <input name="player" required inputMode="numeric" pattern="[0-9]{15,22}" className={styles.input} />
            </Field>
            <Field label="Standing">
              <input name="mmr" type="number" min={0} max={5000} step={1} required defaultValue={1000} className={styles.input} />
            </Field>
          </div>
          <div className={styles.formActions}>
            <SubmitButton tone="plain" confirm="Change this player's standing?">
              Set standing
            </SubmitButton>
          </div>
        </form>
      </div>
    </>
  );
}
