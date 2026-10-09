/**
 * A fighter's shop gear in one raid, read from their purchases.
 *
 * A piece of gear in the pack is a `Purchase` row with status `fulfilled`
 * (see shop/inventory.ts). Using it — arming a carried piece with the first
 * strike, or drinking a flask from the arena — turns that row to `used` and
 * writes where and when into `roleId`, a column gear rows otherwise leave
 * empty: `raid:<bossId>:<epoch ms>`. Nothing else reads `roleId` on a row that
 * is not `fulfilled`, so the role items and the bot are untouched.
 *
 * Everything a fighter's kit does is worked out from those rows, so there is
 * no second record to fall out of step with them. Kept a few seconds per
 * server instance: a raid asks on every batch of strikes.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { GEAR, getGear as getShopGear } from "@/lib/shop/gear";
import { comboKindFor } from "./mechanics/combo";
import {
  BATCH_GRACE_MS,
  BERSERK_REST_MS,
  DRAUGHTS,
  NO_KIT,
  PASSIVE_IDS,
  STEADY_SLIPS,
  STOPPED_HOUR_MS,
  USABLE_IDS,
  USE_GAP_MS,
  gearApplies,
  type Kit,
} from "./kit-rules";

export type KitBoss = {
  id: string;
  mechanic: string;
  templateKey: string | null;
  params: unknown;
};

const GEAR_IDS = GEAR.map((g) => g.id);
const PASSIVE = new Set<string>(PASSIVE_IDS);
const USABLE = new Set<string>(USABLE_IDS);

function prefixFor(bossId: string): string {
  return `raid:${bossId}:`;
}

/** What is written on a row used in a raid. */
export function raidTag(bossId: string, at: number): string {
  return `${prefixFor(bossId)}${at}`;
}

const CACHE_MS = 4000;
const cache = new Map<string, { at: number; armed: boolean; kit: Kit }>();

export function bustKit(bossId: string, discordId: string): void {
  cache.delete(`${bossId}:${discordId}`);
}

/**
 * The fighter's kit for this boss.
 *
 * With `arm`, carried gear that works against this boss and is still in the
 * pack is used up now — this is the fighter joining the fight. Without it the
 * kit is only looked at (a page load): the same gear is shown as at work, since
 * it will be the moment they strike, but nothing is spent.
 *
 * `atLeast` is the version the fighter's arena last saw; a remembered copy
 * older than that is read again. Never throws: a failed read is "no gear".
 */
export async function loadKit(
  boss: KitBoss,
  discordId: string,
  opts: { arm?: boolean; atLeast?: number } = {},
): Promise<Kit> {
  const key = `${boss.id}:${discordId}`;
  const hit = cache.get(key);
  if (
    hit &&
    Date.now() - hit.at < CACHE_MS &&
    (hit.armed || !opts.arm) &&
    hit.kit.v >= (opts.atLeast ?? 0)
  ) {
    return hit.kit;
  }
  try {
    const kit = await readKit(boss, discordId, !!opts.arm);
    cache.set(key, { at: Date.now(), armed: !!opts.arm, kit });
    if (cache.size > 5000) cache.clear();
    return kit;
  } catch (err) {
    logger.error("boss.kit_read_failed", { discordId, bossId: boss.id, message: String(err) });
    return hit?.kit ?? NO_KIT;
  }
}

async function readKit(boss: KitBoss, discordId: string, arm: boolean): Promise<Kit> {
  const prefix = prefixFor(boss.id);
  const rows = await prisma.purchase.findMany({
    where: {
      discordId,
      OR: [
        { status: "used", roleId: { startsWith: prefix } },
        { status: "fulfilled", itemId: { in: GEAR_IDS } },
      ],
    },
    select: { id: true, itemId: true, status: true, roleId: true },
    orderBy: { createdAt: "asc" },
  });
  const combo = comboKindFor(boss.mechanic, boss.templateKey, boss.params);
  const now = Date.now();

  const used = rows
    .filter((r) => r.status === "used")
    .map((r) => ({ id: r.itemId, at: Number(r.roleId?.slice(prefix.length)) || 0 }));
  const pack = rows.filter((r) => r.status === "fulfilled");

  const on = new Set(used.filter((u) => PASSIVE.has(u.id)).map((u) => u.id));
  let v = used.length;

  // carried gear that would work here and is not at work yet: one of each
  const waiting = new Map<string, string>();
  for (const r of pack) {
    if (PASSIVE.has(r.itemId) && !on.has(r.itemId) && !waiting.has(r.itemId)) {
      if (gearApplies(r.itemId, boss.mechanic, combo)) waiting.set(r.itemId, r.id);
    }
  }
  if (waiting.size > 0) {
    if (arm) {
      const armed = await prisma.purchase.updateMany({
        where: { id: { in: [...waiting.values()] }, status: "fulfilled" },
        data: { status: "used", roleId: raidTag(boss.id, now) },
      });
      v += armed.count;
      logger.info("boss.gear_armed", { discordId, bossId: boss.id, gear: [...waiting.keys()] });
    }
    for (const id of waiting.keys()) on.add(id);
  }

  const last = (id: string) => used.reduce((m, u) => (u.id === id ? Math.max(m, u.at) : m), 0);

  // the draught in effect: of those still running, the strongest
  let draughtMult = 1;
  let draughtUntil = 0;
  for (const u of used) {
    const d = DRAUGHTS[u.id];
    if (!d || u.at + d.ms + BATCH_GRACE_MS <= now) continue;
    if (d.mult > draughtMult || (d.mult === draughtMult && u.at + d.ms > draughtUntil)) {
      draughtMult = d.mult;
      draughtUntil = u.at + d.ms;
    }
  }

  const saltsAt = last("smelling-salts");
  const berserkAt = last("berserkers-draught");
  const berserkEnds = berserkAt + DRAUGHTS["berserkers-draught"].ms;
  // salts taken once the draught has worn off clear the rest that follows it
  const restUntil = berserkAt > 0 && !(saltsAt >= berserkEnds) ? berserkEnds + BERSERK_REST_MS : 0;

  const hourAt = last("stopped-hour");
  const spent = used.filter((u) => getShopGear(u.id)?.category === "consumable");
  const lastUse = spent.reduce((m, u) => Math.max(m, u.at), 0);

  const count = new Map<string, number>();
  for (const r of pack) {
    if (USABLE.has(r.itemId) && gearApplies(r.itemId, boss.mechanic, combo)) {
      count.set(r.itemId, (count.get(r.itemId) ?? 0) + 1);
    }
  }

  return {
    v,
    on: GEAR_IDS.filter((id) => on.has(id)),
    carry: GEAR_IDS.filter((id) => count.has(id)).map((id) => ({ id, count: count.get(id)! })),
    used: spent.length,
    nextUseAt: lastUse > 0 ? lastUse + USE_GAP_MS : 0,
    draughtMult,
    draughtUntil,
    restUntil,
    hourUntil: hourAt > 0 ? hourAt + STOPPED_HOUR_MS : 0,
    pact: used.some((u) => u.id === "blood-pact"),
    lures: used.filter((u) => u.id === "rot-lure").map((u) => u.at),
    saltsAt,
    fillAt: last("second-breath"),
    slipsLeft: on.has("steady-hand") ? STEADY_SLIPS : 0,
  };
}

/**
 * Take one of `itemId` out of the fighter's pack and mark it used in this raid.
 * False when they have none left (or another request took it first).
 */
export async function spendFromPack(
  discordId: string,
  itemId: string,
  bossId: string,
  at: number,
): Promise<boolean> {
  const row = await prisma.purchase.findFirst({
    where: { discordId, itemId, status: "fulfilled" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!row) return false;
  const claim = await prisma.purchase.updateMany({
    where: { id: row.id, status: "fulfilled" },
    data: { status: "used", roleId: raidTag(bossId, at) },
  });
  return claim.count === 1;
}

/**
 * Who carried a Warding Charm into this raid, and who swore a Blood Pact in
 * it — what the settling of a failed raid needs to know.
 */
export async function raidMarks(
  bossId: string,
): Promise<Map<string, { ward: boolean; pact: boolean }>> {
  // not caught: a raid must not be settled on a guess at who was warded
  const out = new Map<string, { ward: boolean; pact: boolean }>();
  const rows = await prisma.purchase.findMany({
    where: {
      status: "used",
      itemId: { in: ["warding-charm", "blood-pact"] },
      roleId: { startsWith: prefixFor(bossId) },
    },
    select: { discordId: true, itemId: true },
  });
  for (const r of rows) {
    const m = out.get(r.discordId) ?? { ward: false, pact: false };
    if (r.itemId === "warding-charm") m.ward = true;
    else m.pact = true;
    out.set(r.discordId, m);
  }
  return out;
}
