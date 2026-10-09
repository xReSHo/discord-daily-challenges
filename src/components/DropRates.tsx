import Link from "next/link";
import { ArrowRight, Dices } from "lucide-react";
import {
  BONUS,
  BOSS_DROP_MIN_SHARE,
  BOSS_ODDS,
  BOSS_ODDS_TOP,
  DUPLICATE_COINS,
  RARITIES,
  SLOTS,
  TRIAL_ODDS,
  type Odds,
  type Rarity,
} from "@/lib/equipment";
import styles from "./DropRates.module.css";

/** "3", "0.75": a chance without needless zeroes. */
const pct = (n: number) => `${Number(n.toFixed(2))}%`;

/**
 * One roll, drawn as a single bar: each rarity takes the share of the bar
 * that is its chance, and the dark remainder is the chance of nothing. Under
 * it, the same numbers in words.
 */
function Roll({ title, note, odds }: { title: string; note: string; odds: Odds }) {
  const tiers = RARITIES.filter((r) => odds[r.id]).map((r) => ({ ...r, chance: odds[r.id]! }));
  const any = tiers.reduce((n, t) => n + t.chance, 0);
  return (
    <div className={styles.roll}>
      <p className={styles.rollHead}>
        <b>{title}</b>
        <span>{note}</span>
        <em>{pct(any)} to find something</em>
      </p>
      <div className={styles.bar} aria-hidden>
        {tiers.map((t) => (
          <i key={t.id} className={styles[t.id]} style={{ flexGrow: t.chance }} />
        ))}
        <i className={styles.nothing} style={{ flexGrow: 100 - any }} />
      </div>
      <ul className={styles.tiers}>
        {tiers.map((t) => (
          <li key={t.id} className={styles[t.id]}>
            <i aria-hidden />
            <span>{t.name}</span>
            <b>{pct(t.chance)}</b>
            <small>1 in {Math.round(100 / t.chance)}</small>
          </li>
        ))}
        <li className={styles.none}>
          <i aria-hidden />
          <span>Nothing</span>
          <b>{pct(100 - any)}</b>
        </li>
      </ul>
    </div>
  );
}

/** The live chances and payouts (set in /admin/equipment), as /api/drops sends them. */
export type LiveRates = {
  trials: boolean;
  bosses: boolean;
  trialOdds: Odds;
  bossOdds: Odds;
  bossTopOdds: Odds;
  duplicateCoins: Record<Rarity, number>;
  /** What the viewer's own equipment adds, in words. */
  gear?: string[];
  /** The viewer's Luck, in percent. */
  luck?: number;
};

/**
 * What a trial or a raid can give: the odds of each rarity, what a piece of
 * each kind does, and the rules. Shown in the "Spoils" panel of every game.
 * Without `rates` it shows the built-in figures.
 */
export function DropRates({ source, rates }: { source: "trial" | "boss"; rates?: LiveRates | null }) {
  const boss = source === "boss";
  const odds = boss ? (rates?.bossOdds ?? BOSS_ODDS) : (rates?.trialOdds ?? TRIAL_ODDS);
  const topOdds = rates?.bossTopOdds ?? BOSS_ODDS_TOP;
  const again = rates?.duplicateCoins ?? DUPLICATE_COINS;
  const off = rates ? (boss ? !rates.bosses : !rates.trials) : false;
  // the weakest and the strongest piece this source can give
  const all = boss ? RARITIES.filter((r) => odds[r.id] || topOdds[r.id]) : RARITIES.filter((r) => odds[r.id]);
  const here = all.length ? all : RARITIES;
  const low = here[0];
  const high = here[here.length - 1];
  if (off) {
    return (
      <section className={`${styles.drops} rise`} aria-labelledby={`drops-${source}`}>
        <header className={styles.head}>
          <h2 id={`drops-${source}`} className={styles.title}>
            <Dices size={15} /> {boss ? "Spoils of the raid" : "Spoils of the trials"}
          </h2>
          <Link href="/me#equipment" className={styles.link}>
            Your equipment <ArrowRight size={12} />
          </Link>
        </header>
        <p className={styles.lead}>
          {boss
            ? "No equipment falls from the raid at the moment. Its bounty is paid as usual."
            : "No equipment falls from the trials at the moment. Their coins are paid as usual."}
        </p>
      </section>
    );
  }
  return (
    <section className={`${styles.drops} rise`} aria-labelledby={`drops-${source}`}>
      <header className={styles.head}>
        <h2 id={`drops-${source}`} className={styles.title}>
          <Dices size={15} /> {boss ? "Spoils of the raid" : "Spoils of the trials"}
        </h2>
        <Link href="/me#equipment" className={styles.link}>
          Your equipment <ArrowRight size={12} />
        </Link>
      </header>

      <p className={styles.lead}>
        {boss
          ? "When the boss falls, every fighter who took part rolls once for a piece of equipment."
          : "Every trial you finish is one roll for a piece of equipment, on top of its coins."}
      </p>

      {boss ? (
        <div className={styles.rolls}>
          <Roll title="Every fighter" note="who took part" odds={odds} />
          <Roll title="The top three" note="by damage dealt" odds={topOdds} />
        </div>
      ) : (
        <Roll title="Each trial" note="once a day" odds={odds} />
      )}

      <div className={styles.gives}>
        <p className={styles.givesHead}>
          <b>What a piece does</b>
          <span>
            from <em className={styles[low.id]}>{low.name}</em> to{" "}
            <em className={styles[high.id]}>{high.name}</em>
          </span>
        </p>
        <ul>
          {SLOTS.map((s) => (
            <li key={s.id}>
              <span>{s.name}</span>
              <b>
                +{BONUS[s.id][low.id]}% to +{BONUS[s.id][high.id]}%
              </b>
              <small>{s.does}</small>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.gives}>
        <p className={styles.givesHead}>
          <b>Your equipment right now</b>
        </p>
        {rates?.gear?.length ? (
          <ul className={styles.worn}>
            {rates.gear.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.wornNone}>
            {rates ? "You wear nothing yet, so nothing is added." : "…"}
          </p>
        )}
        {!!rates?.luck && (
          <p className={styles.wornNone}>
            Your Luck stretches every chance above by {rates.luck}%: a 10% chance becomes{" "}
            {Number((10 * (1 + rates.luck / 100)).toFixed(2))}%.
          </p>
        )}
      </div>

      <ul className={styles.rules}>
        {boss ? (
          <>
            <li>
              <b>Take part to roll.</b> You must deal at least {BOSS_DROP_MIN_SHARE * 100}% of the boss&apos;s
              health.
            </li>
            <li>
              <b>Only a slain boss pays.</b> If it escapes, nobody finds anything.
            </li>
            <li>
              <b>Legendaries are the boss&apos;s own.</b> Each boss guards one that no other boss drops.
            </li>
          </>
        ) : (
          <>
            <li>
              <b>The best is elsewhere.</b> Rare and epic pieces fall far more often from a slain boss, and
              legendaries never fall from a trial.
            </li>
            <li>
              <b>Luck helps.</b> An amulet raises every chance here.
            </li>
          </>
        )}
        <li>
          <b>Found it before?</b> You never own a piece twice. A repeat pays coins instead:{" "}
          {here.map((r, i) => (
            <span key={r.id} className={styles[r.id]}>
              {i > 0 && <span className={styles.dot}> · </span>}
              <em>{r.name}</em> {again[r.id].toLocaleString()}
            </span>
          ))}
          .
        </li>
      </ul>
    </section>
  );
}
