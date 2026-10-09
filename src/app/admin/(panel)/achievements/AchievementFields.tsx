"use client";

import { useState } from "react";
import {
  ACHIEVEMENT_ICON_NAMES,
  GAME_IDS,
  GEO_DIFFICULTIES,
  SCORE_KINDS,
  TRIGGER_TYPES,
  type AchievementDef,
} from "@/lib/achievements/catalog";
import styles from "@/app/admin/admin.module.css";

function Field({
  label,
  hint,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`${styles.field} ${wide ? styles.fieldWide : ""}`}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint && <span className={styles.fieldHint}>{hint}</span>}
    </label>
  );
}

const COUNT_LABEL: Record<string, string> = {
  trials_total: "How many trials",
  perfect_days: "How many perfect days",
  perfect_streak: "Days in a row",
  wordle_guesses: "Guesses at most",
  boss_slain: "How many bosses",
  geodash_wins: "How many clears",
  purchases: "How many purchases",
  duel_wins: "How many duels won",
  duel_mmr: "Standing (MMR) to reach",
};

/**
 * The inputs for one achievement. Only the fields that matter for the chosen
 * unlock condition and reward type are shown; the server re-validates the
 * whole thing (see `parseTrigger` / `parseReward`), so this is convenience,
 * not a gate.
 */
export function AchievementFields({ def }: { def?: AchievementDef }) {
  const t = def?.trigger;
  const r = def?.reward;
  const [triggerType, setTriggerType] = useState<string>(t?.type ?? "trials_total");
  const [rewardKind, setRewardKind] = useState<string>(r?.kind ?? "coins");

  const count =
    t && "count" in t
      ? t.count
      : t?.type === "perfect_streak"
        ? t.days
        : t?.type === "wordle_guesses"
          ? t.max
          : "";
  const amount = r?.kind === "coins" ? r.amount : r?.kind === "boost" ? r.percent : "";

  return (
    <div className={styles.formGrid}>
      {def ? (
        <input type="hidden" name="originalKey" value={def.key} />
      ) : (
        <Field label="Key" hint="Permanent. e.g. speed-demon">
          <input name="key" required pattern="[a-z0-9][a-z0-9-]{1,39}" maxLength={40} className={styles.input} />
        </Field>
      )}
      <Field label="Name">
        <input name="name" required maxLength={60} defaultValue={def?.name ?? ""} className={styles.input} />
      </Field>
      <Field label="Icon">
        <select name="icon" defaultValue={def?.icon ?? "sparkles"} className={styles.input}>
          {ACHIEVEMENT_ICON_NAMES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Sort order" hint="Lower shows first.">
        <input name="sortOrder" type="number" step={1} defaultValue={def?.sortOrder ?? 100} className={styles.input} />
      </Field>
      <Field label="Description shown to players" wide>
        <input name="description" required maxLength={200} defaultValue={def?.description ?? ""} className={styles.input} />
      </Field>

      <Field label="Unlocks when a player…">
        <select
          name="triggerType"
          value={triggerType}
          onChange={(e) => setTriggerType(e.target.value)}
          className={styles.input}
        >
          {TRIGGER_TYPES.map((tt) => (
            <option key={tt.type} value={tt.type}>
              {tt.label}
            </option>
          ))}
        </select>
      </Field>

      {triggerType === "score" ? (
        <>
          <Field label="Score">
            <select
              name="scoreKind"
              defaultValue={t?.type === "score" ? t.kind : "wpm"}
              className={styles.input}
            >
              {Object.entries(SCORE_KINDS).map(([id, k]) => (
                <option key={id} value={id}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Value">
            <input
              name="value"
              type="number"
              min={0}
              step="any"
              required
              defaultValue={t?.type === "score" ? t.value : ""}
              className={styles.input}
            />
          </Field>
        </>
      ) : (
        <Field label={COUNT_LABEL[triggerType] ?? "How many"}>
          <input name="count" type="number" min={1} step={1} required defaultValue={count} className={styles.input} />
        </Field>
      )}

      {triggerType === "trials_total" && (
        <Field label="Which game">
          <select
            name="section"
            defaultValue={t?.type === "trials_total" ? (t.section ?? "") : ""}
            className={styles.input}
          >
            <option value="">Any game</option>
            {GAME_IDS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </Field>
      )}

      {triggerType === "geodash_wins" && (
        <Field label="Difficulty">
          <select
            name="difficulty"
            defaultValue={t?.type === "geodash_wins" ? (t.difficulty ?? "") : ""}
            className={styles.input}
          >
            <option value="">Any difficulty</option>
            {GEO_DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Reward">
        <select
          name="rewardKind"
          value={rewardKind}
          onChange={(e) => setRewardKind(e.target.value)}
          className={styles.input}
        >
          <option value="coins">Coins (one time)</option>
          <option value="boost">Permanent % boost on trial rewards</option>
          <option value="role">Discord role</option>
        </select>
      </Field>

      {rewardKind === "role" ? (
        <>
          <Field label="Role name shown">
            <input
              name="roleLabel"
              required
              maxLength={40}
              defaultValue={r?.kind === "role" ? r.label : ""}
              className={styles.input}
            />
          </Field>
          <Field label="Discord role ID" hint="Blank = unlocks, role granted once an ID is set.">
            <input
              name="roleId"
              inputMode="numeric"
              pattern="[0-9]{15,22}"
              defaultValue={r?.kind === "role" ? r.roleId : ""}
              className={styles.input}
            />
          </Field>
        </>
      ) : (
        <Field label={rewardKind === "boost" ? "Boost (%)" : "Coins"}>
          <input
            name="rewardAmount"
            type="number"
            min={1}
            max={rewardKind === "boost" ? 100 : 1_000_000}
            step={1}
            required
            defaultValue={amount}
            className={styles.input}
          />
        </Field>
      )}

      <label className={styles.check}>
        <input name="enabled" type="checkbox" defaultChecked={def?.enabled ?? true} /> Can be
        unlocked
      </label>
    </div>
  );
}
