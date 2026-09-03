import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { AppFrame } from "@/components/AppFrame";
import { getBossConfig, BOSS_DEFAULTS } from "@/lib/boss/config";
import {
  saveBossConfig,
  spawnBoss,
  endBossNow,
  resolveBossNow,
  despawnBoss,
} from "./actions";
import styles from "./boss.module.css";

export const dynamic = "force-dynamic";

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fmt(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

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

export default async function AdminBossPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.discordId)) notFound();

  const [cfg, bosses, hitCounts] = await Promise.all([
    getBossConfig(),
    prisma.boss.findMany({ orderBy: { spawnsAt: "desc" }, take: 15 }),
    prisma.bossHit.groupBy({ by: ["bossId"], _count: { _all: true } }),
  ]);
  const countByBoss = new Map(hitCounts.map((h) => [h.bossId, h._count._all]));

  return (
    <AppFrame>
      <div className="container">
        <header className={`${styles.head} rise`}>
          <Link href="/admin" className={styles.back}>
            <ArrowLeft size={14} /> Admin
          </Link>
          <h1 className={styles.title}>Boss control</h1>
          <p className={styles.sub}>
            The recurring raid and one-off spawns. Config here is the source of
            truth — the env vars are only fallbacks.
          </p>
        </header>

        {/* ---------- recurring config ---------- */}
        <section className={styles.block}>
          <h2 className={styles.blockTitle}>Recurring raid</h2>
          <form action={saveBossConfig} className={styles.form}>
            <label className={styles.field}>
              <span>Name</span>
              <input name="name" defaultValue={cfg.name} className={styles.input} />
            </label>

            <div className={styles.row}>
              <label className={styles.field}>
                <span>Max HP</span>
                <input name="maxHp" type="number" min={1} defaultValue={cfg.maxHp} className={styles.input} />
              </label>
              <label className={styles.field}>
                <span>Bounty pool</span>
                <input name="rewardPool" type="number" min={0} defaultValue={cfg.rewardPool} className={styles.input} />
              </label>
              <label className={styles.field}>
                <span>Fail penalty</span>
                <input name="penalty" type="number" min={0} defaultValue={cfg.penalty} className={styles.input} />
              </label>
            </div>

            <div className={styles.row}>
              <label className={styles.field}>
                <span>Damage / click</span>
                <input name="dmgPerClick" type="number" step="0.01" min={0.0001} defaultValue={cfg.dmgPerClick} className={styles.input} />
              </label>
              <label className={styles.field}>
                <span>Max clicks / sec</span>
                <input name="maxCps" type="number" min={1} max={100} defaultValue={cfg.maxCps} className={styles.input} />
              </label>
            </div>

            <div className={styles.row}>
              <label className={styles.field}>
                <span>Spawn day</span>
                <select name="spawnDow" defaultValue={cfg.spawnDow} className={styles.input}>
                  {DOW.map((d, i) => (
                    <option key={i} value={i}>{d}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Spawn hour (0–23)</span>
                <input name="spawnHour" type="number" min={0} max={23} defaultValue={cfg.spawnHour} className={styles.input} />
              </label>
              <label className={styles.field}>
                <span>Despawn hour</span>
                <input name="despawnHour" type="number" min={0} max={23} defaultValue={cfg.despawnHour} className={styles.input} />
              </label>
              <label className={styles.field}>
                <span>Despawn min</span>
                <input name="despawnMin" type="number" min={0} max={59} defaultValue={cfg.despawnMin} className={styles.input} />
              </label>
            </div>

            <label className={styles.check}>
              <input type="checkbox" name="weeklyEnabled" defaultChecked={cfg.weeklyEnabled} />
              <span>Weekly raid enabled (auto-spawns on the schedule above)</span>
            </label>

            <p className={styles.hint}>
              Times are in {process.env.CHALLENGE_TZ || "Asia/Bahrain"}. Env
              defaults: HP {BOSS_DEFAULTS.maxHp.toLocaleString()}, bounty{" "}
              {BOSS_DEFAULTS.rewardPool.toLocaleString()}, {DOW[BOSS_DEFAULTS.spawnDow]}{" "}
              {BOSS_DEFAULTS.spawnHour}:00.
            </p>

            <button type="submit" className={styles.primary}>Save config</button>
          </form>
        </section>

        {/* ---------- bosses ---------- */}
        <section className={styles.block}>
          <h2 className={styles.blockTitle}>
            Bosses <span className={styles.count}>({bosses.length})</span>
          </h2>
          {bosses.length === 0 ? (
            <p className={styles.empty}>No bosses yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
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
          <h2 className={styles.blockTitle}>Spawn a boss</h2>
          <form action={spawnBoss} className={styles.form}>
            <label className={styles.field}>
              <span>Name</span>
              <input name="name" defaultValue={cfg.name} className={styles.input} />
            </label>

            <div className={styles.row}>
              <label className={styles.field}>
                <span>Max HP</span>
                <input name="maxHp" type="number" min={1} defaultValue={cfg.maxHp} className={styles.input} />
              </label>
              <label className={styles.field}>
                <span>Bounty pool</span>
                <input name="rewardPool" type="number" min={0} defaultValue={cfg.rewardPool} className={styles.input} />
              </label>
              <label className={styles.field}>
                <span>Fail penalty</span>
                <input name="penalty" type="number" min={0} defaultValue={cfg.penalty} className={styles.input} />
              </label>
            </div>

            <div className={styles.row}>
              <label className={styles.field}>
                <span>Start — UTC (blank = now)</span>
                <input name="startsAt" type="datetime-local" className={styles.input} />
              </label>
              <label className={styles.field}>
                <span>End — UTC (blank = auto)</span>
                <input name="endsAt" type="datetime-local" className={styles.input} />
              </label>
              <label className={styles.field}>
                <span>Auto-end after (hours)</span>
                <input name="autoEndHours" type="number" step="0.5" min={0.1} defaultValue={6} className={styles.input} />
              </label>
            </div>

            <label className={styles.check}>
              <input type="checkbox" name="adminOnly" defaultChecked />
              <span>Admins only (regular users never see it)</span>
            </label>
            <label className={styles.check}>
              <input type="checkbox" name="paysOut" />
              <span>Pay real UnbelievaBoat coins on resolve</span>
            </label>

            <p className={styles.hint}>
              Datetime fields are read as <strong>UTC</strong>. Leave both blank
              to spawn now and auto-end after the hours above.
            </p>

            <button type="submit" className={styles.primary}>Spawn</button>
          </form>
        </section>
      </div>
    </AppFrame>
  );
}
