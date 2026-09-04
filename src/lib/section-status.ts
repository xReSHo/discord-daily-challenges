/**
 * Admin game kill-switch.
 *
 * Source of truth is the `SectionStatus` table — one row per game an admin has
 * touched, absent row = enabled. Edited from /admin. When a game is disabled its
 * page shows a notice and its mutating API routes return 503, so a critical bug
 * can be contained without a deploy.
 *
 * Cached ~15s per server instance; {@link bustSectionStatusCache} clears it after
 * a write.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { SECTION_IDS, type SectionId } from "@/lib/sections";

export type SectionStatusView = { disabled: boolean; note: string | null };

const ENABLED: SectionStatusView = { disabled: false, note: null };
const CACHE_MS = 15_000;

let cache: { at: number; map: Map<SectionId, SectionStatusView> } | null = null;

async function loadAll(): Promise<Map<SectionId, SectionStatusView>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.map;

  const map = new Map<SectionId, SectionStatusView>();
  try {
    const rows = await prisma.sectionStatus.findMany();
    for (const r of rows) {
      if ((SECTION_IDS as string[]).includes(r.section)) {
        map.set(r.section as SectionId, {
          disabled: r.disabled,
          note: r.note ?? null,
        });
      }
    }
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

/** Disabled sections → their player-facing note. Enabled sections are absent. */
export async function getDisabledSections(): Promise<Map<SectionId, string | null>> {
  const all = await loadAll();
  const out = new Map<SectionId, string | null>();
  for (const [id, st] of all) if (st.disabled) out.set(id, st.note);
  return out;
}

export async function getSectionStatus(section: SectionId): Promise<SectionStatusView> {
  const all = await loadAll();
  return all.get(section) ?? ENABLED;
}

/** Every game section with its current status — for the /admin control panel. */
export async function getAllSectionStatuses(): Promise<
  { section: SectionId; disabled: boolean; note: string | null }[]
> {
  const all = await loadAll();
  return SECTION_IDS.map((section) => {
    const st = all.get(section) ?? ENABLED;
    return { section, disabled: st.disabled, note: st.note };
  });
}

export async function setSectionStatus(
  section: SectionId,
  disabled: boolean,
  note: string | null,
): Promise<void> {
  const clean = note?.trim().slice(0, 300) || null;
  await prisma.sectionStatus.upsert({
    where: { section },
    create: { section, disabled, note: clean },
    update: { disabled, note: clean },
  });
  bustSectionStatusCache();
  logger.warn("section_status.changed", { section, disabled, note: clean });
}

/**
 * Guard for a mutating game API route. Returns a ready-to-return 503 `Response`
 * when the section is disabled, or `null` to continue.
 *
 *   const closed = await sectionGuard("wordle");
 *   if (closed) return closed;
 */
export async function sectionGuard(section: SectionId): Promise<Response | null> {
  const st = await getSectionStatus(section);
  if (!st.disabled) return null;
  return Response.json(
    {
      error: "closed",
      message: st.note || "This game is temporarily closed for maintenance.",
    },
    { status: 503 },
  );
}
