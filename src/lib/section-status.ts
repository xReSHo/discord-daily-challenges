/**
 * Live per-game settings, edited from /admin/games.
 *
 * Source of truth is the `SectionStatus` table — one row per game an admin has
 * touched, absent row = enabled with the default reward. A game is in one of
 * three states:
 *
 *   open    — playable.
 *   closed  — still listed, but its page shows a notice and its mutating API
 *             routes return 503 (`disabled`). For containing a bug.
 *   hidden  — gone: no dashboard card, its page 404s, its APIs 503, and it no
 *             longer counts toward a perfect day (`hidden`).
 *
 * `reward` overrides the default prize in src/lib/sections.ts, so a change
 * shows up everywhere the reward is displayed or paid without a deploy.
 *
 * Cached ~15s per server instance; {@link bustSectionStatusCache} clears it after
 * a write.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { SECTIONS, SECTION_IDS, type SectionId } from "@/lib/sections";

export type SectionStatusView = {
  disabled: boolean;
  hidden: boolean;
  note: string | null;
  /** Admin override, or null to use the default. */
  reward: number | null;
  /** Admin override of the game's try limit, or null to use the default. */
  tries: number | null;
};

export type SectionState = "open" | "closed" | "hidden";

const ENABLED: SectionStatusView = {
  disabled: false,
  hidden: false,
  note: null,
  reward: null,
  tries: null,
};
const CACHE_MS = 15_000;
export const MAX_REWARD = 1_000_000;

let cache: { at: number; map: Map<SectionId, SectionStatusView> } | null = null;

type StatusRow = {
  section?: unknown;
  disabled?: unknown;
  hidden?: unknown;
  note?: unknown;
  reward?: unknown;
  tries?: unknown;
};

function toMap(rows: StatusRow[]): Map<SectionId, SectionStatusView> {
  const map = new Map<SectionId, SectionStatusView>();
  for (const r of rows) {
    if (typeof r.section === "string" && (SECTION_IDS as string[]).includes(r.section)) {
      map.set(r.section as SectionId, {
        disabled: r.disabled === true,
        hidden: r.hidden === true,
        note: typeof r.note === "string" ? r.note : null,
        reward: typeof r.reward === "number" ? r.reward : null,
        tries: typeof r.tries === "number" ? r.tries : null,
      });
    }
  }
  return map;
}

/** Every game with its settings, from `SELECT * FROM "SectionStatus"` rows the
 *  caller already fetched (the admin pages read them inside their one query). */
export function sectionStatusesFromRows(
  rows: StatusRow[],
): ({ section: SectionId } & SectionStatusView)[] {
  const all = toMap(rows);
  return SECTION_IDS.map((section) => ({ section, ...(all.get(section) ?? ENABLED) }));
}

async function loadAll(): Promise<Map<SectionId, SectionStatusView>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.map;

  let map = new Map<SectionId, SectionStatusView>();
  try {
    map = toMap(await prisma.sectionStatus.findMany());
  } catch (err) {
    // fail OPEN — a status-store outage must not take every game down
    logger.error("section_status.load_failed", { message: String(err) });
    return cache?.map ?? map;
  }

  cache = { at: Date.now(), map };
  return map;
}

export function bustSectionStatusCache(): void {
  cache = null;
}

export function stateOf(st: SectionStatusView): SectionState {
  return st.hidden ? "hidden" : st.disabled ? "closed" : "open";
}

/** Closed (but still listed) sections → their player-facing note. */
export async function getDisabledSections(): Promise<Map<SectionId, string | null>> {
  const all = await loadAll();
  const out = new Map<SectionId, string | null>();
  for (const [id, st] of all) if (st.disabled && !st.hidden) out.set(id, st.note);
  return out;
}

export async function getSectionStatus(section: SectionId): Promise<SectionStatusView> {
  const all = await loadAll();
  return all.get(section) ?? ENABLED;
}

/** Games that appear on the site at all (open or closed), in registry order. */
export async function getVisibleSectionIds(): Promise<SectionId[]> {
  const all = await loadAll();
  return SECTION_IDS.filter((id) => !all.get(id)?.hidden);
}

/** Games a player can actually play right now. */
export async function getActiveSectionIds(): Promise<SectionId[]> {
  const all = await loadAll();
  return SECTION_IDS.filter((id) => {
    const st = all.get(id);
    return !st?.hidden && !st?.disabled;
  });
}

/** The live reward for one game — the admin override, else the default. */
export async function getSectionReward(section: SectionId): Promise<number> {
  const st = await getSectionStatus(section);
  return st.reward ?? SECTIONS[section].reward;
}

/** The live reward for every game. */
export async function getSectionRewards(): Promise<Record<SectionId, number>> {
  const all = await loadAll();
  const out = {} as Record<SectionId, number>;
  for (const id of SECTION_IDS) out[id] = all.get(id)?.reward ?? SECTIONS[id].reward;
  return out;
}

// --- tries ------------------------------------------------------------------

function envCount(name: string, fallback: number, min: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min ? n : fallback;
}

/**
 * What "number of tries" means for each game, and its limits. Each game counts
 * something slightly different, so the label and hint are what the admin form
 * shows next to the number.
 */
export const TRIES: Record<
  SectionId,
  { label: string; hint: string; fallback: number; min: number; max: number }
> = {
  wordle: {
    label: "Guesses",
    hint: "Guesses a player gets to find the word.",
    fallback: 6,
    min: 3,
    max: 10,
  },
  typing: {
    label: "Free tries",
    hint: "Failed runs before the prize starts dropping. The day locks when the prize reaches 0.",
    fallback: envCount("TYPING_FREE_FAILS", 6, 0),
    min: 0,
    max: 100,
  },
  aim: {
    label: "Tries per day",
    hint: "Losing rounds before the day's challenge is failed.",
    fallback: envCount("AIM_MAX_TRIES", 3, 1),
    min: 1,
    max: 100,
  },
  litany: {
    label: "Tries per day",
    hint: "Failed rites before the day is locked. 0 = unlimited.",
    fallback: 0,
    min: 0,
    max: 100,
  },
  geodash: {
    label: "Free retries per fee",
    hint: "Deaths allowed before the player must pay the fee again.",
    fallback: envCount("GEODASH_MAX_RESTARTS", 5, 0),
    min: 0,
    max: 50,
  },
  braziers: {
    label: "Tries per day",
    hint: "Runs a player may begin. A run is spent when it starts, lit or not.",
    fallback: envCount("BRAZIERS_MAX_TRIES", 3, 1),
    min: 1,
    max: 100,
  },
};

/** The live try limit for one game — the admin override, else the default. */
export async function getSectionTries(section: SectionId): Promise<number> {
  const st = await getSectionStatus(section);
  const rule = TRIES[section];
  const n = st.tries ?? rule.fallback;
  return Math.max(rule.min, Math.min(rule.max, n));
}

/** Every game section with its current settings — for the /admin control panel. */
export async function getAllSectionStatuses(): Promise<
  ({ section: SectionId } & SectionStatusView)[]
> {
  const all = await loadAll();
  return SECTION_IDS.map((section) => ({ section, ...(all.get(section) ?? ENABLED) }));
}

export async function saveSectionSettings(
  section: SectionId,
  input: {
    state: SectionState;
    note: string | null;
    reward: number | null;
    tries: number | null;
  },
): Promise<void> {
  const note = input.note?.trim().slice(0, 300) || null;
  const reward =
    input.reward == null
      ? null
      : Math.max(0, Math.min(MAX_REWARD, Math.floor(input.reward)));
  const rule = TRIES[section];
  const tries =
    input.tries == null
      ? null
      : Math.max(rule.min, Math.min(rule.max, Math.floor(input.tries)));
  const data = {
    disabled: input.state === "closed",
    hidden: input.state === "hidden",
    note,
    reward,
    tries,
  };
  await prisma.sectionStatus.upsert({
    where: { section },
    create: { section, ...data },
    update: data,
  });
  bustSectionStatusCache();
  logger.warn("section_status.changed", { section, ...data });
}

/**
 * Guard for a mutating game API route. Returns a ready-to-return 503 `Response`
 * when the section is closed or hidden, or `null` to continue.
 *
 *   const closed = await sectionGuard("wordle");
 *   if (closed) return closed;
 */
export async function sectionGuard(section: SectionId): Promise<Response | null> {
  const st = await getSectionStatus(section);
  if (!st.disabled && !st.hidden) return null;
  return Response.json(
    {
      error: "closed",
      message:
        (!st.hidden && st.note) || "This game is temporarily closed for maintenance.",
    },
    { status: 503 },
  );
}
