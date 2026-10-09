import Link from "next/link";
import { ArrowUpRight, CalendarClock, Swords } from "lucide-react";
import { Prisma } from "@prisma/client";
import { asDate, loadAdminPage } from "@/lib/admin-auth";
import { AdminShell, Field, readFlash } from "@/app/admin/ui";
import { SubmitButton } from "@/app/admin/controls";
import { formatAdminTime } from "@/lib/challenge-date";
import { MAX_BOSS_PENALTY, bossConfigFromRow, type BossConfig } from "@/lib/boss/config";
import { weeklyWindow } from "@/lib/boss/window";
import type { BossTemplateRow } from "@/lib/boss/roster";
import {
  saveBossConfig,
  saveBossTemplate,
  spawnBoss,
  resolveBossNow,
  despawnBoss,
} from "./actions";
import styles from "@/app/admin/admin.module.css";

export const dynamic = "force-dynamic";

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MECHANIC: Record<string, { label: string; blurb: string }> = {
  clicker: { label: "Click race", blurb: "Every click deals damage, up to a cap of clicks a second." },
  eclipse: {
    label: "Eclipse",
    blurb: "A click race whose damage changes with the sky: strong in the dark, normal at dusk, weak in the light.",
  },
  weakpoint: {
    label: "Weak points",
    blurb: "Growths surface around the boss; lancing one deals damage, rarer ones more. A miss grazes and ends the combo; too many stall the fighter.",
  },
  miniarena: {
    label: "Three trials",
    blurb: "Typing, aim and memory trials, each dealing damage by how well it was played.",
  },
};

const fmt = formatAdminTime;
const coins = (n: number) => n.toLocaleString("en-US");

/** "3 h 20 min", "45 min", "2 days" — how far away an instant is. */
function span(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return `${Math.round(m / 1440)} days`;
}

function hourLabel(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;
}

// --- reading a boss's settings ------------------------------------------------

type P = Record<string, unknown>;
const pnum = (p: P, k: string): number | undefined =>
  typeof p[k] === "number" ? (p[k] as number) : undefined;
const prange = (p: P, k: string): [number | undefined, number | undefined] =>
  Array.isArray(p[k])
    ? [Number((p[k] as unknown[])[0]), Number((p[k] as unknown[])[1])]
    : [undefined, undefined];
const psub = (p: P, k: string): P => (p[k] && typeof p[k] === "object" ? (p[k] as P) : {});

/**
 * One number of a boss's settings. `whole` fields take whole numbers; the rest
 * take any decimal. Neither uses a coarse `step`: a browser refuses every value
 * that isn't the starting value plus a multiple of the step, which is how a
 * field ends up rejecting a perfectly good number.
 */
function Num({
  name,
  label,
  hint,
  value,
  whole,
}: {
  name: string;
  label: string;
  hint?: string;
  value: number | undefined;
  whole?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        name={`p_${name}`}
        type="number"
        min={0}
        step={whole ? 1 : "any"}
        defaultValue={value ?? ""}
        className={styles.input}
      />
    </Field>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.groupTitle}>{title}</legend>
      <div className={styles.formGrid}>{children}</div>
    </fieldset>
  );
}

function MechanicFields({ mechanic, params: p }: { mechanic: string; params: P }) {
  if (mechanic === "clicker" || mechanic === "eclipse") {
    const [dMin, dMax] = prange(p, "darkMs");
    const [nMin, nMax] = prange(p, "neutralMs");
    const [lMin, lMax] = prange(p, "lightMs");
    return (
      <>
        <Group title="Clicking">
          <Num name="dmgPerClick" label="Damage per click" value={pnum(p, "dmgPerClick")} />
          <Num
            name="maxCps"
            label="Clicks a second allowed"
            value={pnum(p, "maxCps")}
            whole
            hint="Faster clicks are ignored."
          />
        </Group>
        {mechanic === "eclipse" && (
          <>
            <Group title="Damage multiplier in each phase">
              <Num name="darkMult" label="Dark" value={pnum(p, "darkMult")} />
              <Num name="neutralMult" label="Dusk" value={pnum(p, "neutralMult")} />
              <Num name="lightMult" label="Light" value={pnum(p, "lightMult")} />
            </Group>
            <Group title="How long each phase lasts (milliseconds, picked at random between the two)">
              <Num name="darkMs_min" label="Dark — shortest" value={dMin} whole />
              <Num name="darkMs_max" label="Dark — longest" value={dMax} whole />
              <Num name="neutralMs_min" label="Dusk — shortest" value={nMin} whole />
              <Num name="neutralMs_max" label="Dusk — longest" value={nMax} whole />
              <Num name="lightMs_min" label="Light — shortest" value={lMin} whole />
              <Num name="lightMs_max" label="Light — longest" value={lMax} whole />
            </Group>
          </>
        )}
      </>
    );
  }

  if (mechanic === "weakpoint") {
    return (
      <>
        <Group title="Sacs">
          <Num
            name="dmgPerSac"
            label="Damage per sac"
            value={pnum(p, "dmgPerSac")}
            hint="Rarer growths deal ×2, ×3 and ×5 of this."
          />
          <Num
            name="missDmg"
            label="Damage for a miss"
            value={pnum(p, "missDmg") ?? (pnum(p, "dmgPerSac") ?? 2) / 10}
            hint="A swing that finds nothing. It also ends the combo."
          />
          <Num name="sacIntervalMs" label="A new sac every (ms)" value={pnum(p, "sacIntervalMs")} whole />
          <Num name="sacTtlMs" label="A sac stays for (ms)" value={pnum(p, "sacTtlMs")} whole />
          <Num name="slots" label="Places a sac can appear" value={pnum(p, "slots")} whole />
          <Num
            name="maxSacsPerSec"
            label="Sacs a second allowed"
            value={pnum(p, "maxSacsPerSec")}
            whole
            hint="More than this is ignored."
          />
        </Group>
        <Group title="Combo — lancing in a row without a miss">
          <Num name="comboStep" label="Lances per step" value={pnum(p, "comboStep") ?? 10} whole />
          <Num
            name="comboBonus"
            label="Each step adds"
            value={pnum(p, "comboBonus") ?? 0.1}
            hint="0.1 = +10% damage."
          />
          <Num
            name="comboMax"
            label="Most it can multiply"
            value={pnum(p, "comboMax") ?? 1.5}
            hint="1.5 = at most ×1.5. 1 switches the combo off."
          />
        </Group>
        <Group title="Stall for sloppy play">
          <Num name="stallAt" label="Misses before a stall" value={pnum(p, "stallAt")} whole />
          <Num name="stallMs" label="Stall lasts (ms)" value={pnum(p, "stallMs")} whole />
        </Group>
      </>
    );
  }

  if (mechanic === "miniarena") {
    const t = psub(p, "typing");
    const a = psub(p, "aim");
    const l = psub(p, "litany");
    return (
      <>
        <Group title="Pacing">
          <Num name="cooldownMs" label="Wait between trials (ms)" value={pnum(p, "cooldownMs")} whole />
        </Group>
        <Group title="Typing trial">
          <Num name="typing_words" label="Words to type" value={pnum(t, "words")} whole />
          <Num name="typing_targetWpm" label="Speed for base damage (wpm)" value={pnum(t, "targetWpm")} whole />
          <Num name="typing_dmgBase" label="Base damage" value={pnum(t, "dmgBase")} />
          <Num name="typing_dmgCeil" label="Most damage a run" value={pnum(t, "dmgCeil")} />
        </Group>
        <Group title="Aim trial">
          <Num name="aim_targets" label="Targets" value={pnum(a, "targets")} whole />
          <Num name="aim_radius" label="Target size (0 to 1)" value={pnum(a, "radius")} />
          <Num name="aim_timeLimitMs" label="Time limit (ms)" value={pnum(a, "timeLimitMs")} whole />
          <Num name="aim_targetMs" label="Time a target for base damage (ms)" value={pnum(a, "targetMs")} whole />
          <Num name="aim_dmgBase" label="Base damage" value={pnum(a, "dmgBase")} />
          <Num name="aim_dmgCeil" label="Most damage a run" value={pnum(a, "dmgCeil")} />
        </Group>
        <Group title="Memory trial">
          <Num name="litany_seqLen" label="Rounds" value={pnum(l, "seqLen")} whole />
          <Num name="litany_glyphs" label="Symbols on the ring" value={pnum(l, "glyphs")} whole />
          <Num name="litany_dmgPerRound" label="Damage per round cleared" value={pnum(l, "dmgPerRound")} />
          <Num name="litany_dmgCeil" label="Most damage a run" value={pnum(l, "dmgCeil")} />
        </Group>
      </>
    );
  }

  return null;
}

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function AdminBossPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // The admin check and everything this tab shows, in one round trip.
  const { data } = await loadAdminPage({
    cfg: Prisma.sql`SELECT * FROM "BossConfig" WHERE id = 'singleton'`,
    roster: Prisma.sql`SELECT * FROM "BossTemplate" ORDER BY "sortOrder" ASC`,
    bosses: Prisma.sql`
      SELECT b.id, b.name, b.mechanic, b.source, b."spawnsAt", b."expiresAt",
        b."maxHp", b."dealtDamage", b."rewardPool", b.penalty,
        b."adminOnly", b."paysOut", b.resolved, b.slain,
        (SELECT count(*)::int FROM "BossHit" h WHERE h."bossId" = b.id) AS hits
      FROM "Boss" b ORDER BY b.resolved ASC, b."spawnsAt" DESC LIMIT 14`,
  });
  const cfg = bossConfigFromRow(data.cfg[0] as Partial<BossConfig> | undefined);
  const roster = data.roster.map(
    (t) => ({ ...t, updatedAt: asDate(t.updatedAt) }) as unknown as BossTemplateRow,
  );
  const bosses = data.bosses.map((b) => ({
    id: String(b.id),
    name: String(b.name),
    mechanic: String(b.mechanic),
    source: String(b.source),
    spawnsAt: asDate(b.spawnsAt),
    expiresAt: asDate(b.expiresAt),
    maxHp: Number(b.maxHp),
    dealtDamage: Number(b.dealtDamage),
    rewardPool: Number(b.rewardPool),
    penalty: Number(b.penalty),
    adminOnly: b.adminOnly === true,
    paysOut: b.paysOut === true,
    resolved: b.resolved === true,
    slain: b.slain === true,
    hits: Number(b.hits),
  }));
  const open = bosses.filter((b) => !b.resolved);
  const past = bosses.filter((b) => b.resolved);
  const inDraw = roster.filter((t) => t.enabled).length;

  // eslint-disable-next-line react-hooks/purity -- a server render: "now" is the request
  const now = Date.now();
  const week = weeklyWindow(cfg, new Date(now));
  const startMin = cfg.spawnHour * 60;
  const endMin = cfg.despawnHour * 60 + cfg.despawnMin;
  const windowHours = Math.round(((endMin + 1 - startMin) / 60) * 10) / 10;
  const endMinutes = [0, 15, 30, 45, 59];
  if (!endMinutes.includes(cfg.despawnMin)) endMinutes.push(cfg.despawnMin);

  return (
    <AdminShell title="Boss" flash={readFlash(await searchParams)}>
      {/* ---------- what is happening now ---------- */}
      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Right now</h3>

        {open.length === 0 && (
          <p className={styles.empty}>No raid is running.</p>
        )}

        <div className={styles.cardList}>
          {open.map((b) => {
            const left = Math.max(0, b.maxHp - b.dealtDamage);
            const pct = b.maxHp > 0 ? (left / b.maxHp) * 100 : 0;
            const live = now >= b.spawnsAt.getTime() && now <= b.expiresAt.getTime();
            const upcoming = now < b.spawnsAt.getTime();
            return (
              <div key={b.id} className={`${styles.card} ${live ? styles.raidLive : ""}`}>
                <div className={styles.cardHead}>
                  <span className={styles.cardTitle}>
                    <Swords size={14} /> {b.name}
                  </span>
                  <span className={styles.cardSub}>
                    {MECHANIC[b.mechanic]?.label ?? b.mechanic} ·{" "}
                    {b.adminOnly ? "test — only admins see it" : "public"} ·{" "}
                    {b.paysOut ? "real coins" : "no coins move"}
                  </span>
                  <span
                    className={`${styles.pill} ${
                      live ? styles.pillBad : upcoming ? styles.pillWarn : styles.pillWarn
                    }`}
                  >
                    {live
                      ? `live · ${span(b.expiresAt.getTime() - now)} left`
                      : upcoming
                        ? `starts in ${span(b.spawnsAt.getTime() - now)}`
                        : "ended · not settled yet"}
                  </span>
                </div>

                <div className={styles.hpBar} aria-hidden="true">
                  <i style={{ width: `${pct}%` }} />
                </div>
                <p className={styles.raidFacts}>
                  <span>
                    <b>{coins(Math.round(left))}</b> of {coins(b.maxHp)} health left
                  </span>
                  <span>
                    <b>{b.hits}</b> fighter{b.hits === 1 ? "" : "s"}
                  </span>
                  <span>
                    Reward <b>{coins(b.rewardPool)}</b>
                  </span>
                  <span>
                    Penalty <b>{coins(b.penalty)}</b> each
                  </span>
                  <span>
                    {fmt(b.spawnsAt)} → {fmt(b.expiresAt)}
                  </span>
                </p>

                <div className={styles.formActions}>
                  <Link href="/boss" className={styles.gameBtn}>
                    Open the arena <ArrowUpRight size={11} />
                  </Link>
                  <form action={resolveBossNow}>
                    <input type="hidden" name="id" value={b.id} />
                    <SubmitButton
                      tone="plain"
                      busy="Settling…"
                      confirm={
                        b.paysOut
                          ? "End this raid now and settle it? Real coins will be paid out or taken from everyone who fought."
                          : "End this raid now and settle it? No real coins move for this one."
                      }
                    >
                      End and settle now
                    </SubmitButton>
                  </form>
                  <form action={despawnBoss}>
                    <input type="hidden" name="id" value={b.id} />
                    <SubmitButton
                      tone="danger"
                      busy="Removing…"
                      confirm="Remove this raid without settling it? Nobody is paid and nobody is penalised."
                    >
                      Remove, nothing paid
                    </SubmitButton>
                  </form>
                </div>
              </div>
            );
          })}
        </div>

        <p className={styles.panelNote}>
          <CalendarClock size={12} />{" "}
          {cfg.weeklyEnabled ? (
            <>
              Next weekly raid: <b>{fmt(week.nextSpawnsAt)}</b> (in{" "}
              {span(week.nextSpawnsAt.getTime() - now)}), drawn at random from the {inDraw} boss
              {inDraw === 1 ? "" : "es"} in the draw.
            </>
          ) : (
            <>The weekly raid is switched off — nothing will spawn on its own.</>
          )}
        </p>
      </div>

      {/* ---------- start a raid by hand ---------- */}
      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Start a raid now</h3>
        <form action={spawnBoss} className={styles.card}>
          <div className={styles.formGrid}>
            <Field label="Boss">
              <select name="templateKey" defaultValue={roster[0]?.key ?? ""} className={styles.input}>
                {roster.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                    {t.enabled ? "" : " (benched)"}
                  </option>
                ))}
                <option value="random">Random, from the draw</option>
              </select>
            </Field>
            <Field label="Lasts (hours)" hint="Ignored if you set an end time below.">
              <input
                name="autoEndHours"
                type="number"
                min={0.1}
                max={168}
                step="any"
                defaultValue={6}
                required
                className={styles.input}
              />
            </Field>
          </div>

          <div className={styles.checks}>
            <label className={styles.check}>
              <input type="checkbox" name="adminOnly" defaultChecked />
              <span>
                Test raid — only admins can see it, and the bot stays quiet
              </span>
            </label>
            <label className={styles.check}>
              <input type="checkbox" name="paysOut" />
              <span>Move real coins when it is settled</span>
            </label>
          </div>

          <details className={styles.more}>
            <summary>More options</summary>
            <div className={styles.formGrid}>
              <Field label="Starts" hint="Bahrain time. Blank = now.">
                <input name="startsAt" type="datetime-local" className={styles.input} />
              </Field>
              <Field label="Ends" hint="Bahrain time. Blank = after the hours above.">
                <input name="endsAt" type="datetime-local" className={styles.input} />
              </Field>
              <Field label="Name" hint="Blank = the boss's own.">
                <input name="name" maxLength={80} className={styles.input} />
              </Field>
              <Field label="Health" hint="Blank = the boss's own.">
                <input name="maxHp" type="number" min={1} step={1} className={styles.input} />
              </Field>
              <Field label="Reward pool" hint="Blank = the boss's own.">
                <input name="rewardPool" type="number" min={0} step={1} className={styles.input} />
              </Field>
              <Field label="Penalty each" hint={`Blank = the boss's own. ${coins(MAX_BOSS_PENALTY)} at most.`}>
                <input
                  name="penalty"
                  type="number"
                  min={0}
                  max={MAX_BOSS_PENALTY}
                  step={1}
                  className={styles.input}
                />
              </Field>
            </div>
          </details>

          <div className={styles.formActions}>
            <SubmitButton busy="Starting…">Start the raid</SubmitButton>
          </div>
        </form>
      </div>

      {/* ---------- weekly schedule ---------- */}
      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Weekly raid</h3>
        <form action={saveBossConfig} className={`${styles.card} ${cfg.weeklyEnabled ? "" : styles.cardOff}`}>
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>
              <CalendarClock size={14} /> Every {DOW[cfg.spawnDow]}, {hourLabel(cfg.spawnHour)} to{" "}
              {fmtClock(cfg.despawnHour, cfg.despawnMin)}
            </span>
            <span className={styles.cardSub}>{windowHours} hours · Bahrain time</span>
            <span className={`${styles.pill} ${cfg.weeklyEnabled ? styles.pillOk : styles.pillBad}`}>
              {cfg.weeklyEnabled ? "on" : "off"}
            </span>
          </div>
          <div className={styles.formGrid}>
            <Field label="Day">
              <select name="spawnDow" defaultValue={cfg.spawnDow} className={styles.input}>
                {DOW.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Starts at">
              <select name="spawnHour" defaultValue={cfg.spawnHour} className={styles.input}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ends at — hour">
              <select name="despawnHour" defaultValue={cfg.despawnHour} className={styles.input}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h).replace(":00", "")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ends at — minute" hint="11 PM and 59 = the end of the day.">
              <select name="despawnMin" defaultValue={cfg.despawnMin} className={styles.input}>
                {endMinutes
                  .sort((a, b) => a - b)
                  .map((m) => (
                    <option key={m} value={m}>
                      :{String(m).padStart(2, "0")}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <div className={styles.checks}>
            <label className={styles.check}>
              <input type="checkbox" name="weeklyEnabled" defaultChecked={cfg.weeklyEnabled} />
              <span>Spawn a raid on its own every week</span>
            </label>
          </div>
          <div className={styles.formActions}>
            <SubmitButton>Save schedule</SubmitButton>
          </div>
        </form>
      </div>

      {/* ---------- the bosses ---------- */}
      <div className={styles.block}>
        <h3 className={styles.blockTitle}>
          Bosses{" "}
          <span className={styles.count}>
            ({inDraw} of {roster.length} in the weekly draw)
          </span>
        </h3>
        <p className={styles.panelNote}>
          Open a boss to change it. Changes apply from its next raid — a raid already running keeps
          the numbers it started with. New bosses are added in code; this page tunes the ones that
          exist.
        </p>

        {roster.length === 0 ? (
          <p className={styles.empty}>
            No bosses yet — run <code>node scripts/seed-boss-roster.mjs</code>.
          </p>
        ) : (
          <div className={styles.cardList}>
            {roster.map((t) => (
              <details key={t.key} className={`${styles.card} ${t.enabled ? "" : styles.cardOff}`}>
                <summary className={styles.cardHead}>
                  <span className={styles.cardTitle}>{t.name}</span>
                  <span className={styles.cardSub}>
                    {MECHANIC[t.mechanic]?.label ?? t.mechanic} · {coins(t.maxHp)} health ·{" "}
                    {coins(t.rewardPool)} reward · {coins(t.penalty)} penalty
                  </span>
                  <span className={`${styles.pill} ${t.enabled ? styles.pillOk : styles.pillBad}`}>
                    {t.enabled ? "in the draw" : "benched"}
                  </span>
                </summary>

                <form action={saveBossTemplate}>
                  <input type="hidden" name="key" value={t.key} />
                  <p className={styles.panelNote}>{MECHANIC[t.mechanic]?.blurb ?? ""}</p>

                  <Group title="The basics">
                    <Field label="Name">
                      <input name="name" defaultValue={t.name} maxLength={80} className={styles.input} />
                    </Field>
                    <Field label="Health">
                      <input name="maxHp" type="number" min={1} step={1} defaultValue={t.maxHp} className={styles.input} />
                    </Field>
                    <Field label="Reward pool (coins)" hint="Split between fighters by damage.">
                      <input name="rewardPool" type="number" min={0} step={1} defaultValue={t.rewardPool} className={styles.input} />
                    </Field>
                    <Field label="Penalty each (coins)" hint={`If it survives. ${coins(MAX_BOSS_PENALTY)} at most.`}>
                      <input
                        name="penalty"
                        type="number"
                        min={0}
                        max={MAX_BOSS_PENALTY}
                        step={1}
                        defaultValue={t.penalty}
                        className={styles.input}
                      />
                    </Field>
                    <Field label="How to fight it" hint="One line, shown in the arena and the bot's announcement." wide>
                      <input name="blurb" defaultValue={t.blurb} maxLength={300} className={styles.input} />
                    </Field>
                  </Group>

                  <MechanicFields mechanic={t.mechanic} params={t.params as P} />

                  <div className={styles.checks}>
                    <label className={styles.check}>
                      <input type="checkbox" name="enabled" defaultChecked={t.enabled} />
                      <span>In the weekly draw</span>
                    </label>
                  </div>

                  <div className={styles.formActions}>
                    <SubmitButton>Save {t.name.split(",")[0]}</SubmitButton>
                  </div>
                </form>
              </details>
            ))}
          </div>
        )}
      </div>

      {/* ---------- history ---------- */}
      {past.length > 0 && (
        <div className={styles.block}>
          <h3 className={styles.blockTitle}>
            Past raids <span className={styles.count}>({past.length})</span>
          </h3>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Boss</th>
                  <th>When</th>
                  <th className={styles.num}>Damage dealt</th>
                  <th className={styles.num}>Fighters</th>
                  <th>Kind</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {past.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td className={`mono ${styles.timeCell}`}>
                      {fmt(b.spawnsAt)} → {fmt(b.expiresAt)}
                    </td>
                    <td className={`mono ${styles.num}`}>
                      {coins(Math.round(Math.min(b.dealtDamage, b.maxHp)))} / {coins(b.maxHp)}
                    </td>
                    <td className={`mono ${styles.num}`}>{b.hits}</td>
                    <td>{b.source === "weekly" ? "weekly" : b.adminOnly ? "test" : "manual"}</td>
                    <td>
                      <span className={`${styles.pill} ${b.slain ? styles.pillOk : styles.pillBad}`}>
                        {b.slain ? "slain" : "escaped"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function fmtClock(h: number, m: number): string {
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
