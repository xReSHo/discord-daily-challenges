"use server";

/**
 * Every write the admin panel can make. Each action re-checks the full admin
 * gate itself (allowlist + unlocked second factor) — never trusting that the
 * page it was posted from did — validates its input, writes, and records an
 * `AdminAudit` row. Results come back as a `?ok=` / `?err=` flash on the page.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  enrolAdmin,
  lockAdmin,
  lockAllAdminSessions,
  logAdmin,
  requireAdminAction,
  unlockAdmin,
} from "@/lib/admin-auth";
import { SECTIONS, isSectionId } from "@/lib/sections";
import {
  MAX_REWARD,
  TRIES,
  getSectionStatus,
  saveSectionSettings,
  stateOf,
  type SectionState,
} from "@/lib/section-status";
import { dropFromToday } from "@/lib/day-requirement";
import {
  DROP_ODDS_CAP,
  DROP_ROLLS,
  PIT_MAX_CUT,
  PIT_STAKE_CAP,
  getPitSettings,
  saveCrateSettings,
  saveDropSettings,
  saveGeodashEconomy,
  savePitSettings,
  saveShopSettings,
  type DropRoll,
} from "@/lib/site-settings";
import {
  reopenStuckDuel,
  setStanding,
  settleAllOwed,
  withdrawAllChallenges,
  withdrawChallenge,
} from "@/lib/duel/game";
import { DUPLICATE_COINS } from "@/lib/equipment";
import { CRATE_DEFAULTS, repeatReturn } from "@/lib/crate";
import { payOwedDuplicates } from "@/lib/equipment-drops";
import { prisma } from "@/lib/prisma";
import { challengeDayBoundary } from "@/lib/challenge-date";
import {
  ACHIEVEMENT_ICON_NAMES,
  parseReward,
  parseTrigger,
  rewardLine,
  triggerLine,
} from "@/lib/achievements/catalog";
import {
  deleteAchievementDef,
  getAchievementDef,
  saveAchievementDef,
} from "@/lib/achievements/store";

function flash(path: string, kind: "ok" | "err", message: string): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}

function text(fd: FormData, key: string, max: number): string {
  return String(fd.get(key) ?? "").trim().slice(0, max);
}

/** A whole number in [lo, hi], or null if the field is blank / not a number. */
function intOrNull(fd: FormData, key: string, lo: number, hi: number): number | null {
  const raw = String(fd.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < lo || n > hi) return null;
  return n;
}

function refreshSite(): void {
  revalidatePath("/", "layout");
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
const SNOWFLAKE = /^\d{15,22}$/;
const COIN_CAP = 10_000_000;

// --- access -----------------------------------------------------------------

export type GateState = { error: string | null };

export async function unlockAction(_prev: GateState, fd: FormData): Promise<GateState> {
  const result = await unlockAdmin(
    String(fd.get("password") ?? ""),
    String(fd.get("code") ?? ""),
    fd.get("trust") === "on",
  );
  if (!result.ok) return { error: result.error };
  redirect("/admin");
}

export async function enrolAction(_prev: GateState, fd: FormData): Promise<GateState> {
  const result = await enrolAdmin({
    setupKey: String(fd.get("setupKey") ?? ""),
    password: String(fd.get("password") ?? ""),
    confirm: String(fd.get("confirm") ?? ""),
    ticket: String(fd.get("ticket") ?? ""),
    code: String(fd.get("code") ?? ""),
  });
  if (!result.ok) return { error: result.error };
  redirect("/admin?ok=" + encodeURIComponent("Admin access is set up."));
}

export async function lockAction(): Promise<void> {
  const discordId = await requireAdminAction();
  await lockAdmin();
  await logAdmin(discordId, "lock");
  redirect("/admin/unlock");
}

export async function lockEverywhereAction(): Promise<void> {
  const discordId = await requireAdminAction();
  await lockAllAdminSessions(discordId);
  await logAdmin(discordId, "lock.all_sessions");
  redirect("/admin/unlock");
}

// --- games ------------------------------------------------------------------

export async function saveGameAction(fd: FormData): Promise<void> {
  const discordId = await requireAdminAction();
  const path = "/admin/games";

  const section = String(fd.get("section") ?? "");
  if (!isSectionId(section)) flash(path, "err", "Unknown game.");

  const stateRaw = String(fd.get("state") ?? "");
  if (stateRaw !== "open" && stateRaw !== "closed" && stateRaw !== "hidden") {
    flash(path, "err", "Pick a status for the game.");
  }
  const state = stateRaw as SectionState;

  const rewardRaw = String(fd.get("reward") ?? "").trim();
  let reward: number | null = null;
  if (rewardRaw !== "") {
    reward = intOrNull(fd, "reward", 0, MAX_REWARD);
    if (reward == null) {
      flash(path, "err", `Reward must be a whole number from 0 to ${MAX_REWARD.toLocaleString()}.`);
    }
  }

  const triesRule = TRIES[section];
  const triesRaw = String(fd.get("tries") ?? "").trim();
  let tries: number | null = null;
  if (triesRaw !== "") {
    tries = intOrNull(fd, "tries", triesRule.min, triesRule.max);
    if (tries == null) {
      flash(
        path,
        "err",
        `${triesRule.label} must be a whole number from ${triesRule.min} to ${triesRule.max}.`,
      );
    }
  }

  const before = await getSectionStatus(section);
  const note = text(fd, "note", 300) || null;
  await saveSectionSettings(section, { state, note, reward, tries });
  // Closing or hiding a game mid-day must not cost anyone today's perfect day.
  if (state !== "open" && stateOf(before) === "open") await dropFromToday(section);

  await logAdmin(discordId, "game.save", {
    section,
    state,
    reward,
    tries,
    note,
    was: { state: stateOf(before), reward: before.reward, tries: before.tries },
  });
  refreshSite();
  flash(path, "ok", `${SECTIONS[section].label} saved.`);
}

export async function saveGeodashAction(fd: FormData): Promise<void> {
  const discordId = await requireAdminAction();
  const path = "/admin/games";

  const entry = intOrNull(fd, "entry", 0, COIN_CAP);
  const easy = intOrNull(fd, "easy", 0, COIN_CAP);
  const medium = intOrNull(fd, "medium", 0, COIN_CAP);
  const hard = intOrNull(fd, "hard", 0, COIN_CAP);
  const impossibleMin = intOrNull(fd, "impossibleMin", 1, COIN_CAP);
  const impossibleMult = intOrNull(fd, "impossibleMult", 1, 100);
  if (
    entry == null ||
    easy == null ||
    medium == null ||
    hard == null ||
    impossibleMin == null ||
    impossibleMult == null
  ) {
    flash(path, "err", "Every Geometry Dash number must be a whole number in range.");
  }

  const saved = await saveGeodashEconomy({
    entry,
    rewards: { easy, medium, hard },
    impossibleMin,
    impossibleMult,
  });
  await logAdmin(discordId, "geodash.save", saved);
  refreshSite();
  flash(path, "ok", "Geometry Dash fees and rewards saved.");
}

// --- shop -------------------------------------------------------------------

export async function saveShopAction(fd: FormData): Promise<void> {
  const discordId = await requireAdminAction();
  const open = fd.get("open") === "on";
  const note = text(fd, "note", 300) || null;
  await saveShopSettings({ open, note });
  await logAdmin(discordId, "shop.save", { open, note });
  refreshSite();
  flash("/admin/shop", "ok", open ? "The shop is open." : "The shop is closed.");
}

export async function saveShopItemAction(fd: FormData): Promise<void> {
  const discordId = await requireAdminAction();
  const path = "/admin/shop";

  const originalId = text(fd, "originalId", 40);
  const id = originalId || text(fd, "id", 40).toLowerCase();
  if (!SLUG.test(id)) {
    flash(path, "err", "Item ID must be 2–40 characters: lowercase letters, digits and dashes.");
  }

  const name = text(fd, "name", 60);
  if (!name) flash(path, "err", "The item needs a name.");

  const price = intOrNull(fd, "price", 1, COIN_CAP);
  if (price == null) flash(path, "err", "Price must be a whole number of at least 1.");

  const roleId = text(fd, "roleId", 22);
  if (roleId && !SNOWFLAKE.test(roleId)) {
    flash(path, "err", "Role ID must be a Discord role ID (digits only), or blank for “coming soon”.");
  }

  const durationAmount = intOrNull(fd, "durationAmount", 0, 100_000) ?? 0;
  const unit = String(fd.get("durationUnit") ?? "days");
  const durationSec = durationAmount * (unit === "hours" ? 3600 : 86_400);

  const stockRaw = String(fd.get("stock") ?? "").trim();
  const stock = stockRaw === "" ? null : intOrNull(fd, "stock", 1, 1_000_000);
  if (stockRaw !== "" && stock == null) flash(path, "err", "Stock must be a whole number, or blank for unlimited.");

  const fromRaw = text(fd, "availableFrom", 10);
  const untilRaw = text(fd, "availableUntil", 10);
  const availableFrom = fromRaw ? challengeDayBoundary(fromRaw) : null;
  const availableUntil = untilRaw ? challengeDayBoundary(untilRaw, true) : null;
  if ((fromRaw && !availableFrom) || (untilRaw && !availableUntil)) {
    flash(path, "err", "Those availability dates aren't valid.");
  }
  if (availableFrom && availableUntil && availableUntil < availableFrom) {
    flash(path, "err", "“Available until” is before “available from”.");
  }

  const data = {
    name,
    description: text(fd, "description", 300),
    emoji: text(fd, "emoji", 16) || null,
    price: price as number,
    roleId,
    durationSec,
    stock,
    availableFrom,
    availableUntil,
    enabled: fd.get("enabled") === "on",
    sortOrder: intOrNull(fd, "sortOrder", -10_000, 10_000) ?? 0,
  };

  if (originalId) {
    const updated = await prisma.shopItem.updateMany({ where: { id }, data });
    if (updated.count === 0) flash(path, "err", "That item no longer exists.");
  } else {
    const clash = await prisma.shopItem.findUnique({ where: { id }, select: { id: true } });
    if (clash) flash(path, "err", `An item with the ID “${id}” already exists.`);
    await prisma.shopItem.create({ data: { id, ...data } });
  }

  await logAdmin(discordId, originalId ? "shop.item.update" : "shop.item.create", {
    id,
    name,
    price: data.price,
    roleId,
    durationSec,
    stock,
    enabled: data.enabled,
  });
  refreshSite();
  flash(path, "ok", `${name} saved.`);
}

export async function deleteShopItemAction(fd: FormData): Promise<void> {
  const discordId = await requireAdminAction();
  const id = text(fd, "id", 40);
  const removed = await prisma.shopItem.deleteMany({ where: { id } });
  if (removed.count > 0) await logAdmin(discordId, "shop.item.delete", { id });
  refreshSite();
  flash("/admin/shop", removed.count > 0 ? "ok" : "err", removed.count > 0 ? "Item deleted." : "That item no longer exists.");
}

// --- achievements -----------------------------------------------------------

export async function saveAchievementAction(fd: FormData): Promise<void> {
  const discordId = await requireAdminAction();
  const path = "/admin/achievements";

  const originalKey = text(fd, "originalKey", 40);
  const key = originalKey || text(fd, "key", 40).toLowerCase();
  if (!SLUG.test(key)) {
    flash(path, "err", "Key must be 2–40 characters: lowercase letters, digits and dashes.");
  }

  const name = text(fd, "name", 60);
  const description = text(fd, "description", 200);
  if (!name || !description) flash(path, "err", "An achievement needs a name and a description.");

  const icon = text(fd, "icon", 20);
  if (!ACHIEVEMENT_ICON_NAMES.includes(icon)) flash(path, "err", "Pick an icon from the list.");

  const trigger = parseTrigger({
    type: fd.get("triggerType"),
    count: fd.get("count"),
    days: fd.get("count"),
    max: fd.get("count"),
    value: fd.get("value"),
    section: fd.get("section"),
    kind: fd.get("scoreKind"),
    difficulty: fd.get("difficulty"),
  });
  if (!trigger) flash(path, "err", "That unlock condition isn't complete — check its number.");

  const reward = parseReward({
    kind: fd.get("rewardKind"),
    amount: fd.get("rewardAmount"),
    percent: fd.get("rewardAmount"),
    label: fd.get("roleLabel"),
    roleId: fd.get("roleId"),
  });
  if (!reward) {
    flash(path, "err", "That reward isn't complete — check its amount, or the role name and ID.");
  }

  if (!originalKey && (await getAchievementDef(key))) {
    flash(path, "err", `An achievement with the key “${key}” already exists.`);
  }

  await saveAchievementDef({
    key,
    name,
    description,
    icon,
    trigger: trigger!,
    reward: reward!,
    enabled: fd.get("enabled") === "on",
    sortOrder: intOrNull(fd, "sortOrder", -10_000, 10_000) ?? 0,
  });
  await logAdmin(discordId, originalKey ? "achievement.update" : "achievement.create", {
    key,
    name,
    trigger: triggerLine(trigger!),
    reward: rewardLine(reward!),
    enabled: fd.get("enabled") === "on",
  });
  refreshSite();
  flash(path, "ok", `${name} saved.`);
}

export async function deleteAchievementAction(fd: FormData): Promise<void> {
  const discordId = await requireAdminAction();
  const key = text(fd, "key", 40);
  const deleted = await deleteAchievementDef(key);
  if (deleted) await logAdmin(discordId, "achievement.delete", { key });
  refreshSite();
  flash(
    "/admin/achievements",
    deleted ? "ok" : "err",
    deleted
      ? "Achievement deleted."
      : "Players already hold that achievement, so it can't be deleted — switch it off instead.",
  );
}

// --- the pit ----------------------------------------------------------------

/** "3 waiting challenges withdrawn and refunded", with what could not be. */
function withdrawnLine(out: { refunded: number; failed: number; left: number }): string {
  const parts = [`${out.refunded} waiting ${out.refunded === 1 ? "challenge" : "challenges"} withdrawn and refunded`];
  if (out.failed > 0) parts.push(`${out.failed} could not be refunded and ${out.failed === 1 ? "is" : "are"} still up`);
  else if (out.left > 0) parts.push(`${out.left} still waiting — press “Withdraw every challenge” again`);
  return parts.join("; ");
}

/** A whole number of coins, where a blank field means 0 ("no limit"). */
function limitOrNull(fd: FormData, key: string): number | null {
  return String(fd.get(key) ?? "").trim() === "" ? 0 : intOrNull(fd, key, 0, PIT_STAKE_CAP);
}

export async function savePitAction(fd: FormData): Promise<void> {
  const discordId = await requireAdminAction();
  const path = "/admin/pit";

  const cutRaw = String(fd.get("cut") ?? "").trim();
  const cut = Number(cutRaw);
  if (cutRaw === "" || !Number.isFinite(cut) || cut < 0 || cut > PIT_MAX_CUT) {
    flash(path, "err", `The pit's cut must be a number from 0 to ${PIT_MAX_CUT}.`);
  }
  const minStake = intOrNull(fd, "minStake", 1, PIT_STAKE_CAP);
  const maxStake = limitOrNull(fd, "maxStake");
  const cpuMaxStake = limitOrNull(fd, "cpuMaxStake");
  const maxOpen = intOrNull(fd, "maxOpen", 1, 10);
  if (minStake == null || maxStake == null || cpuMaxStake == null || maxOpen == null) {
    flash(path, "err", "Every stake and limit must be a whole number in range.");
  }
  for (const limit of [maxStake, cpuMaxStake]) {
    if (limit && minStake && limit < minStake) {
      flash(path, "err", "A largest stake can't be below the smallest stake.");
    }
  }

  const before = await getPitSettings();
  const saved = await savePitSettings({
    open: fd.get("open") === "on",
    cpu: fd.get("cpu") === "on",
    players: fd.get("players") === "on",
    note: text(fd, "note", 300) || null,
    cut,
    minStake,
    maxStake,
    cpuMaxStake,
    maxOpen,
  });

  // Closing the pit, or challenges between players, must not leave anyone's
  // stake sitting in a challenge nobody can answer.
  const wasTaking = before.open && before.players;
  const nowTaking = saved.open && saved.players;
  const withdrawn = wasTaking && !nowTaking ? await withdrawAllChallenges() : null;

  await logAdmin(discordId, "pit.save", { ...saved, withdrawn });
  refreshSite();
  if (withdrawn && withdrawn.failed > 0) flash(path, "err", `Saved, but: ${withdrawnLine(withdrawn)}.`);
  flash(
    path,
    "ok",
    `Pit settings saved${withdrawn && withdrawn.refunded + withdrawn.left > 0 ? ` — ${withdrawnLine(withdrawn)}` : ""}.`,
  );
}

export async function pitWithdrawAllAction(): Promise<void> {
  const discordId = await requireAdminAction();
  const out = await withdrawAllChallenges();
  await logAdmin(discordId, "pit.withdraw_all", out);
  refreshSite();
  flash("/admin/pit", out.failed > 0 ? "err" : "ok", `${withdrawnLine(out)}.`);
}

export async function pitWithdrawAction(fd: FormData): Promise<void> {
  const discordId = await requireAdminAction();
  const id = text(fd, "id", 40);
  const out = await withdrawChallenge(id);
  if (out === "refunded") await logAdmin(discordId, "pit.withdraw", { id });
  refreshSite();
  flash(
    "/admin/pit",
    out === "refunded" ? "ok" : "err",
    out === "refunded"
      ? "Challenge withdrawn and its stake returned."
      : out === "gone"
        ? "That challenge is no longer waiting."
        : "The stake couldn't be returned just now, so the challenge is still up. Try again.",
  );
}

export async function pitReopenAction(fd: FormData): Promise<void> {
  const discordId = await requireAdminAction();
  const id = text(fd, "id", 40);
  const done = await reopenStuckDuel(id);
  if (done) await logAdmin(discordId, "pit.reopen", { id });
  refreshSite();
  flash("/admin/pit", done ? "ok" : "err", done ? "Challenge put back up." : "That challenge is no longer stuck.");
}

export async function pitSettleAction(): Promise<void> {
  const discordId = await requireAdminAction();
  const out = await settleAllOwed();
  await logAdmin(discordId, "pit.settle", out);
  refreshSite();
  flash(
    "/admin/pit",
    out.left > 0 ? "err" : "ok",
    out.left > 0
      ? `Tried ${out.tried}; ${out.left} ${out.left === 1 ? "duel is" : "duels are"} still owed. The coin service may be down — try again later.`
      : `Every payment is sent (${out.tried} retried).`,
  );
}

export async function pitStandingAction(fd: FormData): Promise<void> {
  const discordId = await requireAdminAction();
  const path = "/admin/pit";
  const player = text(fd, "player", 22);
  if (!SNOWFLAKE.test(player)) flash(path, "err", "Enter the player's Discord user ID (digits only).");
  const mmr = intOrNull(fd, "mmr", 0, 5000);
  if (mmr == null) flash(path, "err", "Standing must be a whole number from 0 to 5000.");
  await setStanding(player, mmr as number);
  await logAdmin(discordId, "pit.standing", { player, mmr });
  refreshSite();
  flash(path, "ok", `Standing set to ${mmr}.`);
}

// --- equipment drops --------------------------------------------------------

export async function saveDropsAction(fd: FormData): Promise<void> {
  const discordId = await requireAdminAction();
  const path = "/admin/equipment";

  const input: Record<string, unknown> = {
    trials: fd.get("trials") === "on",
    bosses: fd.get("bosses") === "on",
  };
  for (const roll of Object.keys(DROP_ROLLS) as DropRoll[]) {
    const odds: Record<string, number> = {};
    let total = 0;
    for (const rarity of Object.keys(DROP_ROLLS[roll].base)) {
      const raw = String(fd.get(`${roll}.${rarity}`) ?? "").trim();
      const n = Number(raw);
      if (raw === "" || !Number.isFinite(n) || n < 0 || n > 100) {
        flash(path, "err", `${DROP_ROLLS[roll].label}: every chance must be a number from 0 to 100.`);
      }
      odds[rarity] = n;
      total += n;
    }
    if (total > DROP_ODDS_CAP) {
      flash(
        path,
        "err",
        `${DROP_ROLLS[roll].label}: the chances add up to ${Number(total.toFixed(2))}%. Keep them to ${DROP_ODDS_CAP}% or less.`,
      );
    }
    input[roll] = odds;
  }
  const coins: Record<string, number> = {};
  for (const rarity of Object.keys(DUPLICATE_COINS)) {
    const n = intOrNull(fd, `coins.${rarity}`, 0, COIN_CAP);
    if (n == null) flash(path, "err", "Every “found again” payout must be a whole number of coins.");
    coins[rarity] = n as number;
  }
  input.duplicateCoins = coins;

  const saved = await saveDropSettings(input);
  await logAdmin(discordId, "drops.save", saved);
  refreshSite();
  flash(path, "ok", "Equipment drops saved.");
}

export async function payDuplicatesAction(): Promise<void> {
  const discordId = await requireAdminAction();
  const out = await payOwedDuplicates();
  await logAdmin(discordId, "drops.pay_owed", out);
  refreshSite();
  flash(
    "/admin/equipment",
    out.left > 0 ? "err" : "ok",
    out.left > 0
      ? `Tried ${out.tried}; ${out.left} still unpaid. The coin service may be down — try again later.`
      : `Every repeat find is paid (${out.tried} retried).`,
  );
}

// --- the crate --------------------------------------------------------------

export async function saveCrateAction(fd: FormData): Promise<void> {
  const discordId = await requireAdminAction();
  const path = "/admin/equipment";

  const price = intOrNull(fd, "price", 1, COIN_CAP);
  if (price == null) flash(path, "err", "The crate's price must be a whole number of at least 1.");

  const odds: Record<string, number> = {};
  const refund: Record<string, number> = {};
  let total = 0;
  for (const rarity of Object.keys(CRATE_DEFAULTS.odds)) {
    const raw = String(fd.get(`odds.${rarity}`) ?? "").trim();
    const chance = Number(raw);
    if (raw === "" || !Number.isFinite(chance) || chance < 0 || chance > 100) {
      flash(path, "err", "Every crate chance must be a number from 0 to 100.");
    }
    odds[rarity] = chance;
    total += chance;
    const back = intOrNull(fd, `refund.${rarity}`, 0, COIN_CAP);
    if (back == null) flash(path, "err", "Every “if owned” payout must be a whole number of coins.");
    refund[rarity] = back as number;
  }
  const emptyRaw = String(fd.get("odds.empty") ?? "").trim();
  const empty = Number(emptyRaw);
  if (emptyRaw === "" || !Number.isFinite(empty) || empty < 0 || empty > 100) {
    flash(path, "err", "The empty-crate chance must be a number from 0 to 100.");
  }
  // "Empty" is whatever the five rarities leave over, so the six have to make a whole.
  if (Math.abs(total + empty - 100) > 0.005) {
    flash(
      path,
      "err",
      `Not saved: the six chances add up to ${Number((total + empty).toFixed(2))}%. They must total exactly 100% — change the empty chance or a rarity to make up the difference.`,
    );
  }

  // A player who owns every piece gets only the payouts. If those average more
  // than the price, opening crates is a way to print coins.
  const terms = { price: price as number, odds, refund } as typeof CRATE_DEFAULTS;
  const back = repeatReturn(terms);
  if (back >= terms.price) {
    flash(
      path,
      "err",
      `Not saved: a player who owns everything would get back ${Math.round(back).toLocaleString("en-US")} coins per ${terms.price.toLocaleString("en-US")} crate on average, so crates would print coins. Raise the price or lower the payouts or chances.`,
    );
  }

  const saved = await saveCrateSettings({ open: fd.get("open") === "on", price, odds, refund });
  await logAdmin(discordId, "crate.save", saved);
  refreshSite();
  flash(path, "ok", saved.open ? "Crate saved. It is on sale." : "Crate saved. It is off the shelf.");
}
