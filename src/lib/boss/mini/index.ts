/**
 * The Unraveled Saint — mini-arena orchestration.
 *
 * `startMini` issues a signed token bound to (discordId, bossId, game, nonce)
 * and the freshly-derived content. `submitMini` re-derives the content from the
 * nonce, scores it here (never trusting the client), converts the metric to
 * damage per the boss's `params`, and lands it via `applyMiniDamage`. A
 * per-fighter cooldown between runs is enforced on both ends.
 */

import { randomBytes } from "node:crypto";
import { flagAttempt } from "@/lib/audit";
import { signToken, verifyToken } from "@/lib/session-token";
import { prisma } from "@/lib/prisma";
import { applyMiniDamage, getBossState, liveMiniBoss } from "@/lib/boss/game";
import type { BossState } from "@/lib/boss/types";
import { miniAim, miniLitany, miniTyping } from "./content";
import { withHaste } from "@/lib/equipment";
import { getGear } from "@/lib/equipment-effects";
import { scoreMiniAim, scoreMiniLitany, scoreMiniTyping } from "./score";
import { loadKit, type KitBoss } from "@/lib/boss/kit";
import { HOURGLASS_SHARE } from "@/lib/boss/kit-rules";

export const MINI_GAMES = ["typing", "aim", "litany"] as const;
export type MiniGame = (typeof MINI_GAMES)[number];
export function isMiniGame(x: string): x is MiniGame {
  return (MINI_GAMES as readonly string[]).includes(x);
}

const TTL_MS = 5 * 60 * 1000;

type MiniParams = {
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

function n(v: unknown, fallback: number, min = 0): number {
  const x = Number(v);
  return Number.isFinite(x) && x >= min ? x : fallback;
}

function miniParams(params: unknown): MiniParams {
  const p = (params ?? {}) as Record<string, unknown>;
  const t = (p.typing ?? {}) as Record<string, unknown>;
  const a = (p.aim ?? {}) as Record<string, unknown>;
  const l = (p.litany ?? {}) as Record<string, unknown>;
  return {
    cooldownMs: n(p.cooldownMs, 15_000, 0),
    typing: {
      dmgBase: n(t.dmgBase, 90, 0),
      dmgCeil: n(t.dmgCeil, 150, 0),
      targetWpm: n(t.targetWpm, 55, 1),
      words: Math.round(n(t.words, 10, 4)),
    },
    aim: {
      dmgBase: n(a.dmgBase, 70, 0),
      dmgCeil: n(a.dmgCeil, 120, 0),
      targetMs: n(a.targetMs, 650, 1),
      targets: Math.round(n(a.targets, 6, 3)),
      radius: n(a.radius, 0.065, 0.02),
      timeLimitMs: n(a.timeLimitMs, 7000, 2000),
    },
    litany: {
      dmgPerRound: n(l.dmgPerRound, 45, 0),
      dmgCeil: n(l.dmgCeil, 380, 0),
      seqLen: Math.round(n(l.seqLen, 7, 3)),
      glyphs: Math.round(n(l.glyphs, 5, 3)),
    },
  };
}

function seedFor(game: MiniGame, bossId: string, discordId: string, nonce: string): string {
  return `boss-mini:${game}:${bossId}:${discordId}:${nonce}`;
}

async function miniCooldownUntil(boss: KitBoss, discordId: string): Promise<number> {
  const row = await prisma.bossHit.findUnique({
    where: { bossId_discordId: { bossId: boss.id, discordId } },
    select: { meta: true },
  });
  const m = row?.meta as { miniCdUntil?: number; miniCdFrom?: number } | null;
  const until = m?.miniCdUntil ?? 0;
  if (until <= Date.now()) return 0;
  // Smelling Salts taken during this wait ended it
  const kit = await loadKit(boss, discordId);
  const from = m?.miniCdFrom;
  return from !== undefined && kit.saltsAt >= from && kit.saltsAt < until ? 0 : until;
}

export type MiniStartResult =
  | {
      ok: true;
      token: string;
      game: MiniGame;
      content: unknown;
      config: Record<string, number>;
    }
  | { ok: false; reason: string; cooldownUntil?: number };

export async function startMini(
  discordId: string,
  game: MiniGame,
): Promise<MiniStartResult> {
  const boss = await liveMiniBoss(discordId);
  if (!boss) return { ok: false, reason: "No reliquary trial is open right now." };

  const p = miniParams(boss.params);
  const cd = await miniCooldownUntil(boss, discordId);
  if (cd > Date.now()) {
    return { ok: false, reason: "Catch your breath before the next trial.", cooldownUntil: cd };
  }

  const nonce = randomBytes(6).toString("hex");
  const seed = seedFor(game, boss.id, discordId, nonce);
  const token = signToken({ d: discordId, s: `boss-mini-${game}`, bossId: boss.id, nonce });

  if (game === "typing") {
    return { ok: true, game, token, content: miniTyping(seed, p.typing.words), config: {} };
  }
  if (game === "aim") {
    return {
      ok: true,
      game,
      token,
      content: miniAim(seed, p.aim.targets, p.aim.radius),
      config: { timeLimitMs: p.aim.timeLimitMs },
    };
  }
  return {
    ok: true,
    game,
    token,
    content: miniLitany(seed, p.litany.seqLen, p.litany.glyphs),
    config: { flashOnMs: 460, flashGapMs: 200 },
  };
}

export type MiniSubmitResult =
  | {
      ok: true;
      dmg: number;
      /** What the fighter's thread multiplied this trial's damage by. */
      mult: number;
      metric: number;
      game: MiniGame;
      state: BossState;
    }
  | { ok: false; reason: string; state: BossState };

export async function submitMini(
  discordId: string,
  game: MiniGame,
  body: Record<string, unknown>,
): Promise<MiniSubmitResult> {
  const boss = await liveMiniBoss(discordId);
  if (!boss) {
    return { ok: false, reason: "The trial has closed.", state: await getBossState(discordId) };
  }

  const token = typeof body.token === "string" ? body.token : "";
  const payload = verifyToken<{
    d: string;
    s: string;
    bossId: string;
    nonce: string;
    iat: number;
  }>(token);
  if (
    !payload ||
    payload.s !== `boss-mini-${game}` ||
    payload.d !== discordId ||
    payload.bossId !== boss.id
  ) {
    return {
      ok: false,
      reason: "Invalid session. Start the trial again.",
      state: await getBossState(discordId),
    };
  }
  const windowMs = Date.now() - payload.iat;
  if (windowMs > TTL_MS) {
    return {
      ok: false,
      reason: "The trial timed out. Start again.",
      state: await getBossState(discordId),
    };
  }

  const p = miniParams(boss.params);
  const seed = seedFor(game, boss.id, discordId, payload.nonce);
  // the gauntlets: a shorter wait before the next trial. The Saint's Hourglass
  // halves what is left.
  const kit = await loadKit(boss, discordId, { arm: true });
  const cooldownUntil =
    Date.now() +
    withHaste(p.cooldownMs, await getGear(discordId)) *
      (kit.on.includes("saints-hourglass") ? HOURGLASS_SHARE : 1);

  let score;
  let dmg = 0;
  if (game === "typing") {
    const { text } = miniTyping(seed, p.typing.words);
    score = scoreMiniTyping(text, body, windowMs);
    if (score.ok) {
      dmg = Math.min(
        p.typing.dmgCeil,
        p.typing.dmgBase * (score.metric / p.typing.targetWpm) * score.accuracy,
      );
    }
  } else if (game === "aim") {
    const content = miniAim(seed, p.aim.targets, p.aim.radius);
    score = scoreMiniAim(content, body.hits, windowMs, p.aim.timeLimitMs);
    if (score.ok) {
      dmg = Math.min(
        p.aim.dmgCeil,
        p.aim.dmgBase * (p.aim.targetMs / Math.max(1, score.metric)),
      );
    }
  } else {
    const content = miniLitany(seed, p.litany.seqLen, p.litany.glyphs);
    score = scoreMiniLitany(content, body, windowMs);
    if (score.ok) {
      dmg = Math.min(p.litany.dmgCeil, p.litany.dmgPerRound * score.metric);
    }
  }

  if (!score.ok) {
    if (score.flag) {
      flagAttempt(discordId, "boss", score.flag.reason, score.flag.detail);
    }
    const { state } = await applyMiniDamage(discordId, boss.id, 0, cooldownUntil, {
      game,
      ok: false,
    });
    return { ok: false, reason: score.reason, state };
  }

  const landed = await applyMiniDamage(discordId, boss.id, dmg, cooldownUntil, { game, ok: true });
  return {
    ok: true,
    dmg: Math.round(landed.dmg),
    mult: landed.mult,
    metric: score.metric,
    game,
    state: landed.state,
  };
}
