/**
 * Server-side Wordle game state. The client never evaluates a guess and never
 * sees the answer until the game is over.
 *
 * Latency note: the DB may be far from the server, so every round trip counts.
 * A normal guess is two queries: read the row, then one write (an INSERT for
 * the first guess of the day, otherwise a compare-and-swap UPDATE). Page views
 * never write. The daily word is served from an in-process cache (see ./daily),
 * and the reward-status query only runs when a guess actually wins.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getChallengeDate } from "@/lib/challenge-date";
import {
  completeSection,
  getCompletedSectionsToday,
  type CompleteResult,
} from "@/lib/completions";
import { lockNow } from "@/lib/attempts";
import { isDevMode } from "@/lib/dev-mode";
import { getDailyWord } from "./daily";
import { evaluateGuess, type Mark } from "./evaluate";
import { ALLOWED_GUESSES } from "./allowed";

export const MAX_GUESSES = 6;
const SECTION = "wordle" as const;

export type GuessRow = { guess: string; marks: Mark[] };

export type GameView = {
  rows: GuessRow[];
  maxGuesses: number;
  status: "in_progress" | "won" | "lost";
  /** True once the UnbelievaBoat payout for the win has landed. */
  rewarded: boolean;
  /** The answer, revealed only when the game is finished. */
  answer: string | null;
};

type GameRow = {
  guesses: string[];
  won: boolean;
  finished: boolean;
};

const NEW_GAME: GameRow = { guesses: [], won: false, finished: false };

function toView(game: GameRow, word: string, rewarded: boolean): GameView {
  return {
    rows: game.guesses.map((guess) => ({
      guess,
      marks: evaluateGuess(guess, word),
    })),
    maxGuesses: MAX_GUESSES,
    status: game.won ? "won" : game.finished ? "lost" : "in_progress",
    rewarded,
    answer: game.finished ? word : null,
  };
}

async function readGame(discordId: string, date: Date): Promise<GameRow> {
  const row = await prisma.wordleGame.findUnique({
    where: { discordId_date: { discordId, date } },
    select: { guesses: true, won: true, finished: true },
  });
  return row ?? NEW_GAME;
}

export async function getGameView(discordId: string): Promise<GameView> {
  const date = getChallengeDate();

  // Dev mode (admin only): wipe a finished board so re-opening /wordle starts a
  // fresh game. An in-progress game is left alone, so mid-game reloads are safe.
  if (await isDevMode(discordId)) {
    await prisma.wordleGame.deleteMany({ where: { discordId, date, finished: true } });
  }

  // Runs concurrently on the connection pool. getDailyWord is usually cached.
  const [game, word, completed] = await Promise.all([
    readGame(discordId, date),
    getDailyWord(),
    getCompletedSectionsToday(discordId),
  ]);
  // A finished-but-lost game is a failed challenge for the day — record it so
  // the dashboard / admin log reflect it. Idempotent (upsert to failed).
  if (game.finished && !game.won) await lockNow(discordId, SECTION);
  return toView(game, word, game.won && completed.has(SECTION));
}

export type GuessOutcome =
  | { ok: false; error: string }
  | { ok: true; view: GameView; reward: CompleteResult | null };

export async function submitGuess(
  discordId: string,
  rawGuess: unknown,
): Promise<GuessOutcome> {
  const guess = String(rawGuess ?? "").trim().toLowerCase();

  if (!/^[a-z]{5}$/.test(guess)) {
    return { ok: false, error: "Guess must be exactly 5 letters." };
  }
  if (!ALLOWED_GUESSES.has(guess)) {
    return { ok: false, error: "Not in the word list." };
  }

  const date = getChallengeDate();
  const [word, game] = await Promise.all([
    getDailyWord(),
    readGame(discordId, date),
  ]);

  if (game.finished) {
    const rewarded =
      game.won && (await getCompletedSectionsToday(discordId)).has(SECTION);
    return { ok: true, view: toView(game, word, rewarded), reward: null };
  }

  const guesses = [...game.guesses, guess];
  const won = guess === word;
  const finished = won || guesses.length >= MAX_GUESSES;
  const isFirstGuess = game.guesses.length === 0;

  // Apply the guess. Both branches guard against a concurrent guess for the
  // same (user, day): INSERT relies on the primary key, the UPDATE on the
  // "guesses unchanged since we read" condition.
  let applied: boolean;
  if (isFirstGuess) {
    applied = await prisma.wordleGame
      .create({ data: { discordId, date, guesses, won, finished } })
      .then(() => true)
      .catch((err) => {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          return false;
        }
        throw err;
      });
  } else {
    const { count } = await prisma.wordleGame.updateMany({
      where: { discordId, date, finished: false, guesses: { equals: game.guesses } },
      data: { guesses, won, finished },
    });
    applied = count === 1;
  }

  if (!applied) {
    // Lost the race - report the current stored state without applying.
    const fresh = await readGame(discordId, date);
    if (fresh.finished && !fresh.won) await lockNow(discordId, SECTION);
    const rewarded =
      fresh.won && (await getCompletedSectionsToday(discordId)).has(SECTION);
    return { ok: true, view: toView(fresh, word, rewarded), reward: null };
  }

  const updated: GameRow = { guesses, won, finished };

  let reward: CompleteResult | null = null;
  let rewarded = false;
  if (won) {
    reward = await completeSection(discordId, SECTION);
    rewarded =
      reward.status === "rewarded" ||
      (await getCompletedSectionsToday(discordId)).has(SECTION);
  } else if (finished) {
    // Ran out of guesses — a failed challenge for the day.
    await lockNow(discordId, SECTION);
  }

  return { ok: true, view: toView(updated, word, rewarded), reward };
}

/** Retry the payout for a game that was won but not rewarded (e.g. UnbelievaBoat was down). */
export async function claimReward(discordId: string): Promise<GuessOutcome> {
  const view = await getGameView(discordId);
  if (view.status !== "won") {
    return { ok: false, error: "No won game to claim a reward for." };
  }
  if (view.rewarded) {
    return { ok: true, view, reward: null };
  }
  const reward = await completeSection(discordId, SECTION);
  return { ok: true, view: await getGameView(discordId), reward };
}
