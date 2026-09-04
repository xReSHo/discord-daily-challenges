import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { AppFrame } from "@/components/AppFrame";
import { formatAdminTime } from "@/lib/challenge-date";
import { getBossConfig, BOSS_DEFAULTS } from "@/lib/boss/config";
import { getRoster } from "@/lib/boss/roster";
import {
  saveBossConfig,
  saveBossTemplate,
  spawnBoss,
  endBossNow,
  resolveBossNow,
  despawnBoss,
} from "./actions";
import styles from "./boss.module.css";

export const dynamic = "force-dynamic";

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MECHANIC_BLURB: Record<string, string> = {
  clicker: "Click-race. Damage per click, capped clicks/sec.",
  eclipse: "Phase cycle — a normal hit in the dusk, big in the dark, weak in the light.",
  weakpoint: "Tap the silt-sacs as they surface; misses stall the fighter.",
  miniarena: "Three shrunk trials — transcription, aim, litany — each dealing scaled damage.",
};

/** Bahrain AM/PM — consistent with the main /admin ledger. */
const fmt = formatAdminTime;

function bossStatus(b: {
  spawnsAt: Date;
  expiresAt: Date;
  resolved: boolean;
  slain: boolean;
}): string {
  const now = Date.now();
  if (b.resolved) return b.slain ? "resolved · slain" : "resolved · escaped";
  if (now < b.spawnsAt.getTime()) return "upcoming";
  if (now <= b.expiresAt.getTime()) return "LIVE";
  return "ended · unsettled";
}

// --- param readers -------------------------------------------------

type P = Record<string, unknown>;
const pnum = (p: P, k: string): number | undefined =>
  typeof p[k] === "number" ? (p[k] as number) : undefined;
const prange = (p: P, k: string): [number | undefined, number | undefined] =>
  Array.isArray(p[k])
    ? [Number((p[k] as unknown[])[0]), Number((p[k] as unknown[])[1])]
    : [undefined, undefined];
const psub = (p: P, k: string): P =>
  p[k] && typeof p[k] === "object" ? (p[k] as P) : {};

// --- form field helpers -------------------------------------------

function PField({
  name,
  label,
  hint,
  value,
  step = "any",
}: {
  name: string;
  label: string;
  hint?: string;
  value: number | undefined;
  step?: string;
}) {
  return (
    <label className={styles.pField}>
      <span className={styles.pLabel}>{label}</span>
      <input
        name={`p_${name}`}
        type="number"
        step={step}
        defaultValue={value ?? ""}
        className={styles.pInput}
      />
      {hint ? <span className={styles.pHint}>{hint}</span> : null}
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className={styles.pGroup}>
      <legend className={styles.pLegend}>{title}</legend>
      <div className={styles.pGrid}>{children}</div>
    </fieldset>
  );
}

function MechanicFields({ mechanic, params }: { mechanic: string; params: P }) {
  const p = params;

  if (mechanic === "clicker") {
    return (
      <Group title="Click damage">
        <PField name="dmgPerClick" label="Damage per click" value={pnum(p, "dmgPerClick")} hint="e.g. 0.1" />
        <PField name="maxCps" label="Max clicks / sec" value={pnum(p, "maxCps")} step="1" hint="anti-spam cap" />
      </Group>
    );
  }

  if (mechanic === "eclipse") {
    const [dMin, dMax] = prange(p, "darkMs");
    const [nMin, nMax] = prange(p, "neutralMs");
    const [lMin, lMax] = prange(p, "lightMs");
    return (
      <>
        <Group title="Click damage">
          <PField name="dmgPerClick" label="Damage per click" value={pnum(p, "dmgPerClick")} hint="e.g. 0.1" />
          <PField name="maxCps" label="Max clicks / sec" value={pnum(p, "maxCps")} step="1" />
        </Group>
        <Group title="Phase multipliers (hits ×)">
          <PField name="darkMult" label="Dark — black sun open" value={pnum(p, "darkMult")} hint="e.g. 2.5" />
          <PField name="neutralMult" label="Neutral — normal hit" value={pnum(p, "neutralMult")} hint="usually 1" />
          <PField name="lightMult" label="Light — barely lands" value={pnum(p, "lightMult")} hint="e.g. 0.15" />
        </Group>
        <Group title="Phase length — random within each range (ms)">
          <PField name="darkMs_min" label="Dark — min" value={dMin} step="500" />
          <PField name="darkMs_max" label="Dark — max" value={dMax} step="500" />
          <PField name="neutralMs_min" label="Neutral — min" value={nMin} step="500" />
          <PField name="neutralMs_max" label="Neutral — max" value={nMax} step="500" />
          <PField name="lightMs_min" label="Light — min" value={lMin} step="500" />
          <PField name="lightMs_max" label="Light — max" value={lMax} step="500" />
        </Group>
      </>
    );
  }

  if (mechanic === "weakpoint") {
    return (
      <>
        <Group title="Silt-sacs">
          <PField name="slots" label="Surfacing positions" value={pnum(p, "slots")} step="1" />
          <PField name="sacIntervalMs" label="New sac every (ms)" value={pnum(p, "sacIntervalMs")} step="50" />
          <PField name="sacTtlMs" label="Sac lifetime (ms)" value={pnum(p, "sacTtlMs")} step="50" />
          <PField name="dmgPerSac" label="Damage per sac" value={pnum(p, "dmgPerSac")} />
          <PField name="maxSacsPerSec" label="Max credited / sec" value={pnum(p, "maxSacsPerSec")} step="1" hint="anti-cheat cap" />
        </Group>
        <Group title="Corruption stall">
          <PField name="stallAt" label="Sloppy flushes before a stall" value={pnum(p, "stallAt")} step="1" />
          <PField name="stallMs" label="Stall length (ms)" value={pnum(p, "stallMs")} step="250" />
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
          <PField name="cooldownMs" label="Cooldown between trials (ms)" value={pnum(p, "cooldownMs")} step="1000" />
        </Group>
        <Group title="Transcription — typing">
          <PField name="typing_words" label="Words to transcribe" value={pnum(t, "words")} step="1" />
          <PField name="typing_targetWpm" label="Target WPM (full damage)" value={pnum(t, "targetWpm")} step="1" />
          <PField name="typing_dmgBase" label="Base damage" value={pnum(t, "dmgBase")} />
          <PField name="typing_dmgCeil" label="Max damage / run" value={pnum(t, "dmgCeil")} />
        </Group>
        <Group title="Trial of Aim">
          <PField name="aim_targets" label="Targets" value={pnum(a, "targets")} step="1" />
          <PField name="aim_radius" label="Target radius (0–1)" value={pnum(a, "radius")} />
          <PField name="aim_timeLimitMs" label="Time limit (ms)" value={pnum(a, "timeLimitMs")} step="500" />
          <PField name="aim_targetMs" label="Target ms / strike (full dmg)" value={pnum(a, "targetMs")} step="10" />
          <PField name="aim_dmgBase" label="Base damage" value={pnum(a, "dmgBase")} />
          <PField name="aim_dmgCeil" label="Max damage / run" value={pnum(a, "dmgCeil")} />
        </Group>
        <Group title="The Litany">
          <PField name="litany_seqLen" label="Sequence length" value={pnum(l, "seqLen")} step="1" />
          <PField name="litany_glyphs" label="Glyphs on the ring" value={pnum(l, "glyphs")} step="1" />
          <PField name="litany_dmgPerRound" label="Damage per round cleared" value={pnum(l, "dmgPerRound")} />
          <PField name="litany_dmgCeil" label="Max damage / run" value={pnum(l, "dmgCeil")} />
        </Group>
      </>
    );
  }

  return null;
}

export default async function AdminBossPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.discordId)) notFound();

  const [cfg, roster, bosses, hitCounts] = await Promise.all([
    getBossConfig(),
    getRoster(),
    prisma.boss.findMany({ orderBy: { spawnsAt: "desc" }, take: 15 }),
    prisma.bossHit.groupBy({ by: ["bossId"], _count: { _all: true } }),
  ]);
  const countByBoss = new Map(hitCounts.map((h) => [h.bossId, h._count._all]));
  const enabledCount = roster.filter((t) => t.enabled).length;

  return (
    <AppFrame>
      <div className="container">
        <header className={`${styles.head} rise`}>
          <Link href="/admin" className={styles.back}>
            <ArrowLeft size={14} /> Admin
          </Link>
          <h1 className={styles.title}>Boss control</h1>
          <p className={styles.sub}>
            One boss is drawn from the roster each week — at random, never the
            same two weeks running. Expand a boss to tune it.
          </p>
        </header>

        {/* ---------- roster ---------- */}
        <section className={styles.block}>
          <h2 className={styles.blockTitle}>
            Roster{" "}
            <span className={styles.count}>
              ({enabledCount} of {roster.length} in the draw)
            </span>
          </h2>

          {roster.length === 0 ? (
            <p className={styles.empty}>
              Roster not seeded — run{" "}
              <code>node scripts/seed-boss-roster.mjs</code>.
            </p>
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Boss</th>
                      <th>Mechanic</th>
                      <th className={styles.num}>HP</th>
                      <th className={styles.num}>Pool</th>
                      <th className={styles.num}>Penalty</th>
                      <th>In draw</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((t) => (
                      <tr key={t.key}>
                        <td>{t.name}</td>
                        <td>{t.mechanic}</td>
                        <td className={`mono ${styles.num}`}>{t.maxHp.toLocaleString()}</td>
                        <td className={`mono ${styles.num}`}>{t.rewardPool.toLocaleString()}</td>
                        <td className={`mono ${styles.num}`}>{t.penalty.toLocaleString()}</td>
                        <td className={t.enabled ? styles.live : styles.muted}>
                          {t.enabled ? "yes" : "benched"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.rosterCards}>
                {roster.map((t) => (
                  <details key={t.key} className={styles.rosterCard}>
                    <summary className={styles.rosterSummary}>
                      <span className={styles.rosterName}>{t.name}</span>
                      <span className={styles.rosterTags}>
                        <span className={styles.mechTag}>{t.mechanic}</span>
                        <span className="mono">{t.maxHp.toLocaleString()} HP</span>
                        <span className={t.enabled ? styles.onTag : styles.offTag}>
                          {t.enabled ? "in draw" : "benched"}
                        </span>
                      </span>
                    </summary>

                    <form action={saveBossTemplate} className={styles.form}>
                      <input type="hidden" name="key" value={t.key} />
                      <p className={styles.mechNote}>
                        {MECHANIC_BLURB[t.mechanic] ?? ""}
                      </p>

                      <Group title="Identity">
                        <label className={styles.pField}>
                          <span className={styles.pLabel}>Name</span>
                          <input name="name" defaultValue={t.name} className={styles.pInput} />
                        </label>
                        <label className={styles.pField}>
                          <span className={styles.pLabel}>Mechanic (fixed)</span>
                          <input value={t.mechanic} disabled className={styles.pInput} />
                        </label>
                      </Group>

                      <label className={styles.field}>
                        <span>Blurb — arena &amp; the bot&apos;s spawn embed</span>
                        <input
                          name="blurb"
                          defaultValue={t.blurb}
                          placeholder="How this boss is fought, in one line"
                          className={styles.input}
                        />
                      </label>

                      <Group title="Reward &amp; health">
                        <label className={styles.pField}>
                          <span className={styles.pLabel}>Max HP</span>
                          <input name="maxHp" type="number" min={1} defaultValue={t.maxHp} className={styles.pInput} />
                        </label>
                        <label className={styles.pField}>
                          <span className={styles.pLabel}>Bounty pool (coins)</span>
                          <input name="rewardPool" type="number" min={0} defaultValue={t.rewardPool} className={styles.pInput} />
                        </label>
                        <label className={styles.pField}>
                          <span className={styles.pLabel}>Fail penalty (coins)</span>
                          <input name="penalty" type="number" min={0} defaultValue={t.penalty} className={styles.pInput} />
                        </label>
                      </Group>

                      <MechanicFields mechanic={t.mechanic} params={t.params as P} />

                      <label className={styles.check}>
                        <input type="checkbox" name="enabled" defaultChecked={t.enabled} />
                        <span>Include in the weekly random draw</span>
                      </label>

                      <button type="submit" className={styles.primary}>
                        Save {t.name.split(",")[0]}
                      </button>
                    </form>
                  </details>
                ))}
              </div>
            </>
          )}
        </section>

        {/* ---------- schedule ---------- */}
        <section className={styles.block}>
          <h2 className={styles.blockTitle}>Weekly schedule</h2>
          <form action={saveBossConfig} className={styles.form}>
            <Group title="Spawn window">
              <label className={styles.pField}>
                <span className={styles.pLabel}>Spawn day</span>
                <select name="spawnDow" defaultValue={cfg.spawnDow} className={styles.pInput}>
                  {DOW.map((d, i) => (
                    <option key={i} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.pField}>
                <span className={styles.pLabel}>Spawn hour (0–23)</span>
                <input name="spawnHour" type="number" min={0} max={23} defaultValue={cfg.spawnHour} className={styles.pInput} />
              </label>
              <label className={styles.pField}>
                <span className={styles.pLabel}>Despawn hour</span>
                <input name="despawnHour" type="number" min={0} max={23} defaultValue={cfg.despawnHour} className={styles.pInput} />
              </label>
              <label className={styles.pField}>
                <span className={styles.pLabel}>Despawn minute</span>
                <input name="despawnMin" type="number" min={0} max={59} defaultValue={cfg.despawnMin} className={styles.pInput} />
              </label>
            </Group>

            <label className={styles.check}>
              <input type="checkbox" name="weeklyEnabled" defaultChecked={cfg.weeklyEnabled} />
              <span>Weekly raid enabled (auto-spawns on the schedule above)</span>
            </label>

            <p className={styles.hint}>
              Times are in {process.env.CHALLENGE_TZ || "Asia/Bahrain"}. Env
              defaults: {DOW[BOSS_DEFAULTS.spawnDow]} {BOSS_DEFAULTS.spawnHour}:00
              → {BOSS_DEFAULTS.despawnHour}:
              {String(BOSS_DEFAULTS.despawnMin).padStart(2, "0")}.
            </p>

            <button type="submit" className={styles.primary}>
              Save schedule
            </button>
          </form>
        </section>

        {/* ---------- bosses ---------- */}
        <section className={styles.block}>
          <h2 className={styles.blockTitle}>
            Spawned bosses <span className={styles.count}>({bosses.length})</span>
          </h2>
          {bosses.length === 0 ? (
            <p className={styles.empty}>No bosses yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Mechanic</th>
                    <th>Source</th>
                    <th>Window</th>
                    <th className={styles.num}>HP</th>
                    <th className={styles.num}>Fighters</th>
                    <th>Flags</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bosses.map((b) => {
                    const canManage = !b.resolved;
                    return (
                      <tr key={b.id}>
                        <td>{b.name}</td>
                        <td>{b.mechanic}</td>
                        <td>{b.source}</td>
                        <td className="mono">
                          {fmt(b.spawnsAt)} → {fmt(b.expiresAt)}
                        </td>
                        <td className={`mono ${styles.num}`}>
                          {Math.round(Math.max(0, b.maxHp - b.dealtDamage)).toLocaleString()}/
                          {b.maxHp.toLocaleString()}
                        </td>
                        <td className={`mono ${styles.num}`}>{countByBoss.get(b.id) ?? 0}</td>
                        <td>
                          {b.adminOnly ? "admin-only " : "public "}
                          {b.paysOut ? "· pays" : "· no pay"}
                        </td>
                        <td className={b.resolved ? styles.muted : styles.live}>
                          {bossStatus(b)}
                        </td>
                        <td>
                          <div className={styles.actions}>
                            {canManage && (
                              <form action={endBossNow}>
                                <input type="hidden" name="id" value={b.id} />
                                <button className={styles.miniBtn}>End</button>
                              </form>
                            )}
                            {canManage && (
                              <form action={resolveBossNow}>
                                <input type="hidden" name="id" value={b.id} />
                                <button className={styles.miniBtn}>Resolve</button>
                              </form>
                            )}
                            {canManage && (
                              <form action={despawnBoss}>
                                <input type="hidden" name="id" value={b.id} />
                                <button className={`${styles.miniBtn} ${styles.danger}`}>
                                  Despawn
                                </button>
                              </form>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ---------- spawn ---------- */}
        <section className={styles.block}>
          <h2 className={styles.blockTitle}>Spawn a boss (test)</h2>
          <form action={spawnBoss} className={styles.form}>
            <Group title="Which boss">
              <label className={styles.pField}>
                <span className={styles.pLabel}>From roster</span>
                <select name="templateKey" defaultValue="" className={styles.pInput}>
                  <option value="">— none (legacy clicker) —</option>
                  <option value="random">Random (enabled only)</option>
                  {roster.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name} · {t.mechanic}
                      {t.enabled ? "" : " (benched)"}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.pField}>
                <span className={styles.pLabel}>Name override</span>
                <input name="name" placeholder="blank = template" className={styles.pInput} />
              </label>
              <label className={styles.pField}>
                <span className={styles.pLabel}>Max HP override</span>
                <input name="maxHp" type="number" min={1} placeholder="blank = template" className={styles.pInput} />
              </label>
              <label className={styles.pField}>
                <span className={styles.pLabel}>Bounty pool override</span>
                <input name="rewardPool" type="number" min={0} placeholder="blank = template" className={styles.pInput} />
              </label>
              <label className={styles.pField}>
                <span className={styles.pLabel}>Fail penalty override</span>
                <input name="penalty" type="number" min={0} placeholder="blank = template" className={styles.pInput} />
              </label>
            </Group>

            <Group title="Timing (UTC)">
              <label className={styles.pField}>
                <span className={styles.pLabel}>Start (blank = now)</span>
                <input name="startsAt" type="datetime-local" className={styles.pInput} />
              </label>
              <label className={styles.pField}>
                <span className={styles.pLabel}>End (blank = auto)</span>
                <input name="endsAt" type="datetime-local" className={styles.pInput} />
              </label>
              <label className={styles.pField}>
                <span className={styles.pLabel}>Auto-end after (hours)</span>
                <input name="autoEndHours" type="number" step="0.5" min={0.1} defaultValue={6} className={styles.pInput} />
              </label>
            </Group>

            <label className={styles.check}>
              <input type="checkbox" name="adminOnly" defaultChecked />
              <span>Admins only (regular users never see it)</span>
            </label>
            <label className={styles.check}>
              <input type="checkbox" name="paysOut" />
              <span>Pay real UnbelievaBoat coins on resolve</span>
            </label>

            <p className={styles.hint}>
              Pick a roster boss to test its mechanic. Leave admin-only on so it
              stays hidden from players and the bot.
            </p>

            <button type="submit" className={styles.primary}>
              Spawn
            </button>
          </form>
        </section>
      </div>
    </AppFrame>
  );
}
