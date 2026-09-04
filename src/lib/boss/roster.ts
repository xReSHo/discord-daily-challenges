/**
 * The boss roster — the pool one boss is drawn from for each weekly spawn.
 *
 * Rows live in the `BossTemplate` table (edited from /admin/boss, seeded by
 * scripts/seed-boss-roster.mjs). `pickWeeklyTemplate` is deterministic per
 * week — so a race between two lazy creators picks the same boss — and never
 * repeats the immediately-previous weekly boss.
 *
 * `params` is mechanic-specific; the shapes below are the contract. Both the
 * stats and `params` are snapshotted onto the `Boss` row at spawn.
 */

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type BossMechanic = "clicker" | "eclipse" | "weakpoint" | "miniarena";

export type ClickerParams = {
  dmgPerClick: number;
  maxCps: number;
};

export type EclipseParams = ClickerParams & {
  /** Full light→dark→light period. */
  cycleMs: number;
  /** How much of the cycle the weak-point ("black sun") is open. */
  darkMs: number;
  /** Damage multiplier while the black sun is open / shut. */
  darkMult: number;
  lightMult: number;
};

export type WeakpointParams = {
  /** Anchor positions the sacs surface at. */
  slots: number;
  sacTtlMs: number;
  sacIntervalMs: number;
  dmgPerSac: number;
  /** Missed taps before a stall. */
  stallAt: number;
  stallMs: number;
  /** Server ceiling on sacs credited per second (anti-cheat). */
  maxSacsPerSec: number;
};

export type MiniArenaParams = {
  /** Per-fighter wait between mini runs. */
  cooldownMs: number;
  typing: { dmgBase: number; dmgCeil: number; targetWpm: number; words: number };
  aim: {
    dmgBase: number;
    dmgCeil: number;
    targetMs: number;
    targets: number;
    radius: number;
    timeLimitMs: number;
  };
  litany: { dmgPerRound: number; dmgCeil: number; seqLen: number; glyphs: number };
};

export type BossParams =
  | ClickerParams
  | EclipseParams
  | WeakpointParams
  | MiniArenaParams;

export type BossTemplateRow = Prisma.BossTemplateGetPayload<object>;

// --- reads (30s cache, mirrors getBossConfig) -------------------------

let cache: { at: number; rows: BossTemplateRow[] } | null = null;
const CACHE_MS = 30_000;

async function allTemplates(): Promise<BossTemplateRow[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  let rows: BossTemplateRow[] = [];
  try {
    rows = await prisma.bossTemplate.findMany({ orderBy: { sortOrder: "asc" } });
  } catch {
    // DB unreachable — an empty roster makes the caller fall back to the
    // legacy BossConfig path, which is a fine degradation.
  }
  cache = { at: Date.now(), rows };
  return rows;
}

export function bustRosterCache(): void {
  cache = null;
}

/** Every template, enabled or not (admin editor). */
export async function getRoster(): Promise<BossTemplateRow[]> {
  return allTemplates();
}

export async function getTemplate(key: string): Promise<BossTemplateRow | null> {
  return (await allTemplates()).find((t) => t.key === key) ?? null;
}

// --- weekly pick -----------------------------------------------------

/** Deterministic 32-bit unsigned hash of a string. */
function seedInt(s: string): number {
  return createHash("sha256").update(s).digest().readUInt32BE(0);
}

/**
 * The boss for the given weekly window. Deterministic per `weekOf`, drawn from
 * the enabled templates, excluding whichever boss ran last week (unless that's
 * the only one enabled). Returns null when the roster is empty — the caller
 * then falls back to the legacy BossConfig boss.
 */
export async function pickWeeklyTemplate(
  weekOf: string,
): Promise<BossTemplateRow | null> {
  const enabled = (await allTemplates()).filter((t) => t.enabled);
  if (enabled.length === 0) return null;
  if (enabled.length === 1) return enabled[0];

  const lastWeekly = await prisma.boss
    .findFirst({
      where: { source: "weekly", templateKey: { not: null } },
      orderBy: { spawnsAt: "desc" },
      select: { templateKey: true },
    })
    .catch(() => null);

  const pool = enabled.filter((t) => t.key !== lastWeekly?.templateKey);
  const draw = pool.length > 0 ? pool : enabled;

  // stable order for a stable index
  draw.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return draw[seedInt(`boss-roster:${weekOf}`) % draw.length];
}
