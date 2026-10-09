"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Coins,
  Dices,
  RotateCcw,
  ScrollText,
  Swords,
  Users,
  X,
} from "lucide-react";
import type { DuelResult, OpenChallenge, Pit as PitData, PitTerms } from "@/lib/duel/game";
import {
  MOVES,
  MOVE_IDS,
  RANKS,
  ROUNDS,
  WIN_AT,
  cutFor,
  nextRank,
  rankOf,
  split,
  type Move,
} from "@/lib/duel/rules";
import { Face } from "@/app/leaderboard/Face";
import { play } from "@/lib/sfx";
import styles from "./duel.module.css";

const QUICK = [1000, 5000, 25000, 100000];
/** How long each round holds the stage when a duel is shown. */
const ROUND_MS = 1100;

const coins = (n: number) => n.toLocaleString("en-US");

/** The painted emblems, cut out (see scripts/cut-item-art.mjs). */
const MOVE_ART: Record<Move, string> = { S: "strike", G: "guard", F: "feint" };
const duelArt = (name: string) => `/art/duel/${name}-v1-160.webp`;

/** A move's emblem. `size` is the line icon's; the painting is drawn larger to read as well. */
function MoveMark({ move, size = 20 }: { move: Move; size?: number }) {
  const px = Math.round(size * 1.7);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={duelArt(MOVE_ART[move])}
      alt=""
      aria-hidden
      width={px}
      height={px}
      className={styles.moveArt}
      draggable={false}
    />
  );
}

/**
 * The pit: where a player stands, the form that starts or answers a duel, the
 * challenges waiting for an answer, and their own past duels. A decided duel
 * is played back round by round in a dialog.
 */
export function Pit({ pit, practice, terms }: { pit: PitData; practice: boolean; terms: PitTerms }) {
  const router = useRouter();
  const [vs, setVs] = useState<"cpu" | "open">(terms.cpu ? "cpu" : "open");
  const [answering, setAnswering] = useState<OpenChallenge | null>(null);
  const [stake, setStake] = useState("1000");
  const [moves, setMoves] = useState<Move[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [shown, setShown] = useState<DuelResult | null>(null);
  const form = useRef<HTMLDivElement>(null);

  const { standing } = pit;
  const rank = rankOf(standing.mmr);
  const next = nextRank(standing.mmr);
  const stakeNum = answering ? answering.stake : Math.floor(Number(stake)) || 0;
  const cut = cutFor(pit.sword, terms.cut);
  const win = split(Math.max(0, stakeNum), pit.sword, terms.cut).payout;
  // an answered challenge is for its own stake, whatever the limits are now
  const limit = answering ? null : vs === "cpu" ? terms.maxCpu : terms.maxOpen;
  const tooMuch = limit != null && stakeNum > limit;
  const canFight = answering ? terms.players : vs === "cpu" ? terms.cpu : terms.players;
  const ready = moves.length === ROUNDS && stakeNum >= terms.minStake && !tooMuch && canFight && !busy;

  function add(m: Move) {
    setMoves((list) => (list.length < ROUNDS ? [...list, m] : list));
  }

  async function post(path: string, body: object) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        result?: DuelResult;
        posted?: boolean;
      };
      if (!res.ok) {
        setError(data.error || "That didn't go through. Try again.");
        return null;
      }
      return data;
    } catch {
      setError("Network error. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function fightNow() {
    const data = answering
      ? await post("/api/duel/accept", { id: answering.id, moves: moves.join("") })
      : await post("/api/duel/create", { stake: stakeNum, moves: moves.join(""), vs });
    if (!data) {
      if (answering) router.refresh(); // it may have been taken: show what is left
      return;
    }
    setMoves([]);
    setAnswering(null);
    if (data.result) setShown(data.result);
    else if (data.posted) setNote("Your challenge is up. It will be fought the moment someone answers it.");
    router.refresh(); // the purse, the standing and the lists all change
  }

  async function withdraw(id: string) {
    const data = await post("/api/duel/cancel", { id });
    if (data) setNote("Challenge withdrawn. Your stake is back in your purse.");
    router.refresh();
  }

  function answer(c: OpenChallenge) {
    setAnswering(c);
    setMoves([]);
    setError("");
    setNote("");
    form.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <>
      {/* where you stand */}
      <section className={`${styles.standing} rise`} aria-label="Your standing">
        <div className={styles.rank}>
          <span className={styles.rankMark} data-rank={rank.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={duelArt(`rank-${rank.id}`)} alt="" width={64} height={64} draggable={false} />
          </span>
          <span>
            <small>Your rank</small>
            <strong>{rank.name}</strong>
          </span>
        </div>
        <div className={styles.ladder}>
          <div className={styles.ladderTop}>
            <b>{standing.mmr}</b>
            <span>
              {next ? `${next.from - standing.mmr} to ${next.name}` : "The highest rank in the pit"}
            </span>
          </div>
          <ol className={styles.steps}>
            {RANKS.map((r) => (
              <li key={r.id} className={standing.mmr >= r.from ? styles.stepOn : undefined}>
                <i aria-hidden />
                {r.name}
                <small>{r.from === 0 ? "start" : r.from}</small>
              </li>
            ))}
          </ol>
        </div>
        <dl className={styles.record}>
          <div>
            <dt>
              <Users size={11} /> Against players
            </dt>
            <dd>
              {standing.wins}
              <small>W</small> {standing.losses}
              <small>L</small> {standing.draws}
              <small>D</small>
            </dd>
          </div>
          <div>
            <dt>
              <Bot size={11} /> Against the champion
            </dt>
            <dd>
              {standing.cpuWins}
              <small>W</small> {standing.cpuLosses}
              <small>L</small>
            </dd>
          </div>
        </dl>
      </section>

      <div className={styles.cols}>
        {/* start or answer a duel */}
        <section ref={form} className={`${styles.panel} rise`} aria-label="Fight a duel">
          <h2 className={styles.h}>{answering ? "Answer the challenge" : "Enter the pit"}</h2>

          {answering ? (
            <p className={styles.answering}>
              <span>
                Against <b>{answering.name}</b> for <b>{coins(answering.stake)}</b> coins. Their moves are
                already sealed.
              </span>
              <button type="button" onClick={() => setAnswering(null)}>
                <X size={12} /> Back
              </button>
            </p>
          ) : (
            <>
              <div className={styles.vs} role="group" aria-label="Opponent">
                <button
                  type="button"
                  aria-pressed={vs === "cpu"}
                  onClick={() => setVs("cpu")}
                  disabled={!terms.cpu}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={duelArt("champion")} alt="" width={40} height={40} className={styles.champ} draggable={false} />
                  <span>
                    The champion
                    <small>{terms.cpu ? "Fought at once. No rank at stake." : "Not taking duels for now."}</small>
                  </span>
                </button>
                <button
                  type="button"
                  aria-pressed={vs === "open"}
                  onClick={() => setVs("open")}
                  disabled={practice || !terms.players}
                >
                  <Users size={16} />
                  <span>
                    Another player
                    <small>
                      {practice
                        ? "Closed in dev mode."
                        : terms.players
                          ? "Post a challenge. Rank is at stake."
                          : "Closed for now."}
                    </small>
                  </span>
                </button>
              </div>

              <label className={styles.stake}>
                <span>Your stake</span>
                <span className={styles.stakeBox}>
                  <Coins size={15} />
                  <input
                    type="number"
                    inputMode="numeric"
                    min={terms.minStake}
                    max={limit ?? undefined}
                    step={1}
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                    aria-describedby="stake-note"
                  />
                </span>
              </label>
              <div className={styles.quick}>
                {QUICK.map((q) => (
                  <button key={q} type="button" onClick={() => setStake(String(q))}>
                    {coins(q)}
                  </button>
                ))}
              </div>
            </>
          )}

          <p id="stake-note" className={styles.stakeNote}>
            {practice ? (
              <>Dev mode: a practice duel. No coins move and nothing is recorded.</>
            ) : tooMuch ? (
              <>
                The largest stake {vs === "cpu" ? "against the champion" : "here"} is {coins(limit ?? 0)} coins.
              </>
            ) : stakeNum >= terms.minStake ? (
              <>
                Win and you take <b>{coins(win)}</b>. The pit keeps {cut}% of the pot
                {pit.sword > 0 && terms.cut > 0 ? <> (your sword brings it down from {terms.cut}%)</> : null}. A
                drawn duel returns both stakes.
              </>
            ) : (
              <>The smallest stake is {coins(terms.minStake)} coins.</>
            )}
          </p>

          <h3 className={styles.h3}>Your five moves, in order</h3>
          <ol className={styles.slots}>
            {Array.from({ length: ROUNDS }, (_, i) => {
              const m = moves[i];
              return (
                <li key={i}>
                  <button
                    type="button"
                    className={`${styles.slot} ${m ? styles[`m${m}`] : ""}`}
                    onClick={() => setMoves((list) => list.slice(0, i))}
                    disabled={!m}
                    aria-label={m ? `Round ${i + 1}: ${MOVES[m].name}. Press to clear from here.` : `Round ${i + 1}: empty`}
                  >
                    <small>{i + 1}</small>
                    {m ? <MoveMark move={m} size={22} /> : <span aria-hidden>·</span>}
                    <em>{m ? MOVES[m].name : ""}</em>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className={styles.picks}>
            {MOVE_IDS.map((m) => (
              <button
                key={m}
                type="button"
                className={`${styles.pick} ${styles[`m${m}`]}`}
                onClick={() => add(m)}
                disabled={moves.length >= ROUNDS}
              >
                <MoveMark move={m} size={24} />
                <b>{MOVES[m].name}</b>
                <small>{MOVES[m].line}</small>
              </button>
            ))}
          </div>
          <div className={styles.tools}>
            <button
              type="button"
              onClick={() =>
                setMoves(Array.from({ length: ROUNDS }, () => MOVE_IDS[Math.floor(Math.random() * 3)]))
              }
            >
              <Dices size={13} /> Leave it to fate
            </button>
            <button type="button" onClick={() => setMoves([])} disabled={moves.length === 0}>
              <RotateCcw size={13} /> Clear
            </button>
          </div>

          <button type="button" className={styles.go} onClick={fightNow} disabled={!ready} data-sfx-own>
            <Swords size={16} />
            {busy
              ? "Steel is drawn…"
              : answering || vs === "cpu"
                ? practice
                  ? "Fight a practice duel"
                  : `Fight for ${coins(stakeNum)}`
                : `Post a challenge for ${coins(stakeNum)}`}
          </button>
          {error && <p className={styles.error}>{error}</p>}
          {note && <p className={styles.note}>{note}</p>}
        </section>

        <div className={styles.side}>
          {/* challenges waiting for an answer */}
          <section className={`${styles.panel} rise`} aria-label="Open challenges">
            <h2 className={styles.h}>
              Open challenges <small>{pit.open.length}</small>
            </h2>
            {pit.open.length === 0 ? (
              <p className={styles.empty}>
                Nobody is waiting. Post a challenge of your own, or take on the champion.
              </p>
            ) : (
              <ul className={styles.open}>
                {pit.open.map((c) => (
                  <li key={c.id} className={c.mine ? styles.mine : undefined}>
                    <Face image={c.image} name={c.name} className={styles.avatar} />
                    <span className={styles.who}>
                      <b>{c.mine ? "Your challenge" : c.name}</b>
                      <small>
                        {rankOf(c.mmr).name} · {c.mmr}
                      </small>
                    </span>
                    <span className={styles.pot}>
                      <Coins size={13} /> {coins(c.stake)}
                    </span>
                    {c.mine ? (
                      <button type="button" className={styles.quiet} onClick={() => withdraw(c.id)} disabled={busy}>
                        Withdraw
                      </button>
                    ) : (
                      <button type="button" className={styles.take} onClick={() => answer(c)} disabled={practice}>
                        Answer
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* your own past duels */}
          <section className={`${styles.panel} rise`} aria-label="Your recent duels">
            <h2 className={styles.h}>Your recent duels</h2>
            {pit.past.length === 0 ? (
              <p className={styles.empty}>You have not fought yet.</p>
            ) : (
              <ul className={styles.past}>
                {pit.past.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => setShown(d)} data-outcome={d.outcome}>
                      <b>{d.outcome === "win" ? "Won" : d.outcome === "lose" ? "Lost" : "Drawn"}</b>
                      <span className={styles.who}>
                        <b>{d.opponent}</b>
                        <small>
                          {d.me}–{d.them} · staked {coins(d.stake)}
                        </small>
                      </span>
                      <span className={styles.delta}>
                        {d.outcome === "win" ? `+${coins(d.paid - d.stake)}` : d.outcome === "lose" ? `−${coins(d.stake)}` : "±0"}
                        {d.mmr !== 0 && (
                          <small>
                            {d.mmr > 0 ? "+" : "−"}
                            {Math.abs(d.mmr)} rank
                          </small>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* the rules, for whoever wants them */}
      <details className={`${styles.rules} rise`}>
        <summary>
          <ScrollText size={14} /> How a duel works
        </summary>
        <div>
          <ul className={styles.beats}>
            {MOVE_IDS.map((m) => (
              <li key={m} className={styles[`m${m}`]}>
                <MoveMark move={m} size={18} />
                <b>{MOVES[m].name}</b> beats <b>{MOVES[MOVES[m].beats].name}</b>
              </li>
            ))}
          </ul>
          <ul className={styles.law}>
            <li>
              <b>Five rounds, first to {WIN_AT}.</b> Both orders are sealed before either is seen. The same move
              twice is a tied round and scores nothing.
            </li>
            <li>
              <b>Equal stakes.</b> The winner takes the pot less the pit&apos;s {terms.cut}% cut. If neither is ahead
              at the end the duel is drawn and both stakes go back.
            </li>
            <li>
              <b>Your sword trims the cut.</b> Each rarity takes a tenth off what the pit keeps from your
              winnings, down to {cutFor(5, terms.cut)}% with a legendary. It never changes who wins.
            </li>
            <li>
              <b>Rank is won from players.</b> Beating another player raises your standing and losing lowers
              it, more so against someone ranked above you. The champion pays coin but no rank.
            </li>
            <li>
              <b>A challenge waits for you.</b> Post one and it is fought the moment someone answers, whether
              or not you are here. You can withdraw it for your stake until then.
            </li>
          </ul>
        </div>
      </details>

      {shown && <Replay duel={shown} onClose={() => setShown(null)} />}
    </>
  );
}

/** A decided duel, played back one round at a time, then the verdict. */
function Replay({ duel, onClose }: { duel: DuelResult; onClose: () => void }) {
  const sheet = useRef<HTMLDialogElement>(null);
  const [upTo, setUpTo] = useState(0);
  const done = upTo >= duel.rounds.length;

  useEffect(() => {
    const el = sheet.current;
    if (el && !el.open) el.showModal();
  }, []);

  // one more round on the stage every beat, each with its own sound
  useEffect(() => {
    if (done) {
      play(duel.outcome === "win" ? "found" : "tap");
      return;
    }
    const t = setTimeout(() => {
      play("pick");
      setUpTo((n) => n + 1);
    }, upTo === 0 ? 500 : ROUND_MS);
    return () => clearTimeout(t);
  }, [upTo, done, duel.outcome]);

  const seen = duel.rounds.slice(0, upTo);
  const me = seen.filter((r) => r.win === "me").length;
  const them = seen.filter((r) => r.win === "them").length;

  return (
    <dialog
      ref={sheet}
      className={styles.replay}
      onClose={onClose}
      onClick={(e) => e.target === sheet.current && sheet.current?.close()}
      aria-label="The duel"
    >
      <div className={styles.replayIn}>
        <header className={styles.score}>
          <span>
            <small>You</small>
            <b>{me}</b>
          </span>
          <i aria-hidden>vs</i>
          <span>
            <small>{duel.opponent}</small>
            <b>{them}</b>
          </span>
        </header>

        <ol className={styles.rounds}>
          {duel.rounds.map((r, i) => {
            const on = i < upTo;
            return (
              <li key={i} className={on ? styles.roundOn : undefined} data-win={on ? r.win : undefined}>
                <span className={`${styles.card} ${on ? styles[`m${r.me}`] : ""}`}>
                  {on ? (
                    <>
                      <MoveMark move={r.me} size={22} />
                      <em>{MOVES[r.me].name}</em>
                    </>
                  ) : (
                    <span aria-hidden>?</span>
                  )}
                </span>
                <small>{on ? (r.win === "tie" ? "Tied" : r.win === "me" ? "Yours" : "Theirs") : `Round ${i + 1}`}</small>
                <span className={`${styles.card} ${on ? styles[`m${r.them}`] : ""}`}>
                  {on ? (
                    <>
                      <MoveMark move={r.them} size={22} />
                      <em>{MOVES[r.them].name}</em>
                    </>
                  ) : (
                    <span aria-hidden>?</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>

        <div className={styles.verdict} data-outcome={done ? duel.outcome : undefined} aria-live="polite">
          {done ? (
            <>
              <strong>{duel.outcome === "win" ? "Victory" : duel.outcome === "lose" ? "Defeat" : "A drawn duel"}</strong>
              <p>
                {duel.practice
                  ? "A practice duel: no coins moved."
                  : duel.outcome === "win"
                    ? `You take ${coins(duel.paid)} coins, ${coins(duel.paid - duel.stake)} more than you staked.`
                    : duel.outcome === "lose"
                      ? `Your ${coins(duel.stake)} coins go to ${duel.opponent}.`
                      : `Both stakes are returned: ${coins(duel.stake)} coins back to you.`}
                {duel.mmr !== 0 && (
                  <span>
                    {" "}
                    Standing {duel.mmr > 0 ? "+" : "−"}
                    {Math.abs(duel.mmr)}.
                  </span>
                )}
              </p>
              <button type="button" className={styles.go} onClick={() => sheet.current?.close()}>
                Leave the pit floor
              </button>
            </>
          ) : (
            <button type="button" className={styles.quiet} onClick={() => setUpTo(duel.rounds.length)}>
              Skip to the end
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
