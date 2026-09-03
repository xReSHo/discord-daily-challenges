"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Volume2, VolumeX } from "lucide-react";
import {
  SIM_DT,
  ORB_RADIUS,
  PAD_RADIUS,
  initState,
  step,
  hits,
  moverPos,
  rotorAngles,
  type Course,
  type SimState,
  type GeoEvent,
} from "@/lib/geodash/physics";
import type { GeoState, SubmitResult } from "@/lib/geodash/game";
import styles from "./geodash.module.css";

type Difficulty = "easy" | "medium" | "hard" | "impossible";
const TIERS: Difficulty[] = ["easy", "medium", "hard", "impossible"];
const LABEL: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  impossible: "Impossible",
};

// slow-motion assist window for jump orbs
const SLOW_SCALE = 0.26;
const SLOWMO_WINDOW_MS = 1000; // real ms the player gets to press jump
const SLOWMO_EASE_MS = 130;

// ---------------------------------------------------------------------------
// synthesised rhythm + SFX (Web Audio — no asset files, no music)
// ---------------------------------------------------------------------------

type SoundKit = {
  muted: boolean;
  toggle: () => boolean;
  resume: () => void;
  beat: (strong: boolean) => void;
  jump: () => void;
  land: () => void;
  orb: () => void;
  pad: () => void;
  slow: () => void;
  die: () => void;
  win: () => void;
  close: () => void;
};

function makeSound(): SoundKit | null {
  let ctx: AudioContext | null = null;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  } catch {
    return null;
  }
  const ac = ctx;
  const master = ac.createGain();
  master.gain.value = 0.5;
  master.connect(ac.destination);

  let muted = false;
  try {
    muted = localStorage.getItem("geodash_muted") === "1";
  } catch {
    /* ignore */
  }

  const tone = (
    type: OscillatorType,
    f0: number,
    f1: number,
    attack: number,
    decay: number,
    peak: number,
  ) => {
    if (muted) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + attack + decay);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + attack + decay + 0.03);
  };
  const noise = (dur: number, peak: number, lp: number) => {
    if (muted) return;
    const t = ac.currentTime;
    const n = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = lp;
    const g = ac.createGain();
    g.gain.value = peak;
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
  };

  return {
    get muted() {
      return muted;
    },
    toggle() {
      muted = !muted;
      try {
        localStorage.setItem("geodash_muted", muted ? "1" : "0");
      } catch {
        /* ignore */
      }
      return muted;
    },
    resume() {
      if (ac.state === "suspended") void ac.resume();
    },
    beat(strong) {
      if (strong) tone("sine", 96, 44, 0.004, 0.14, 0.5);
      else tone("sine", 1180, 1180, 0.002, 0.035, 0.05);
    },
    jump() {
      tone("triangle", 320, 540, 0.003, 0.06, 0.16);
    },
    land() {
      noise(0.055, 0.16, 1500);
      tone("sine", 140, 74, 0.003, 0.08, 0.24);
    },
    orb() {
      tone("sine", 640, 960, 0.004, 0.2, 0.2);
      tone("sine", 960, 1300, 0.004, 0.16, 0.1);
    },
    pad() {
      tone("sawtooth", 170, 720, 0.01, 0.22, 0.18);
      noise(0.16, 0.09, 3000);
    },
    slow() {
      tone("sine", 520, 190, 0.02, 0.34, 0.14);
    },
    die() {
      tone("sawtooth", 300, 38, 0.004, 0.55, 0.5);
      noise(0.32, 0.32, 2000);
    },
    win() {
      [523, 659, 784, 1047].forEach((f, i) =>
        window.setTimeout(() => tone("triangle", f, f, 0.008, 0.2, 0.22), i * 95),
      );
    },
    close() {
      try {
        void ac.close();
      } catch {
        /* ignore */
      }
    },
  };
}

// ---------------------------------------------------------------------------

type Phase =
  | { k: "select" }
  | { k: "locked"; difficulty: Difficulty; stake: number; restartsLeft: number }
  | { k: "stake"; repay: boolean }
  | {
      k: "confirm";
      difficulty: Difficulty;
      cost: number;
      reward: number;
      stake: number;
      repay: boolean;
    }
  | {
      k: "running";
      course: Course;
      token: string;
      difficulty: Difficulty;
      stake: number;
      restartsLeft: number;
    }
  | {
      k: "result";
      result: SubmitResult;
      difficulty: Difficulty;
      stake: number;
    };

function startError(code?: string, message?: string): string {
  switch (code) {
    case "insufficient":
      return "You don't have enough coins for that.";
    case "already_played":
      return message ?? "You've already played today's Geometry Dash.";
    case "bad_stake":
      return message ?? "That stake isn't allowed.";
    case "bad_difficulty":
      return "Pick a difficulty first.";
    case "unavailable":
      return "The coin service is unavailable right now — try again shortly.";
    default:
      return message ?? "Could not start the run.";
  }
}

export function GeoDash({ state }: { state: GeoState }) {
  const router = useRouter();
  const [sound, setSound] = useState<SoundKit | null>(null);

  const [phase, setPhase] = useState<Phase>(() => {
    const r = state.run;
    if (r.status === "open") {
      return {
        k: "locked",
        difficulty: r.difficulty,
        stake: r.stake,
        restartsLeft: r.restartsLeft,
      };
    }
    if (r.status === "spent") {
      return {
        k: "result",
        result: {
          ok: false,
          outcome: "spent",
          distancePct: r.distancePct,
          feesPaid: r.feesPaid,
          devMode: false,
        },
        difficulty: r.difficulty,
        stake: r.stake,
      };
    }
    if (r.status === "won") {
      return {
        k: "result",
        result: { ok: true, outcome: "won", payout: r.payout, newBalance: null, devMode: false },
        difficulty: r.difficulty,
        stake: r.stake,
      };
    }
    if (r.status === "rejected") {
      return {
        k: "result",
        result: {
          ok: false,
          outcome: "rejected",
          reason: "This run was rejected by the anti-cheat checks.",
          devMode: false,
        },
        difficulty: r.difficulty,
        stake: r.stake,
      };
    }
    return { k: "select" };
  });

  const [stakeInput, setStakeInput] = useState(String(state.impossibleMin));
  const [tierOpen, setTierOpen] = useState<Difficulty | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => () => sound?.close(), [sound]);

  const balance = state.balance?.total ?? null;

  const feeReward = (d: Difficulty, stake: number) => {
    if (d === "impossible") return { cost: stake, reward: stake * state.multiplier };
    return { cost: state.entry, reward: state.entry + state.rewards[d] };
  };

  const armSound = () => {
    let s = sound;
    if (!s) {
      s = makeSound();
      setSound(s);
    }
    s?.resume();
  };

  const doStart = useCallback(
    async (difficulty: Difficulty, stake: number) => {
      setBusy(true);
      setError("");
      try {
        const res = await fetch("/api/geodash/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ difficulty, stake }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setError(startError(data?.error, data?.message));
          return;
        }
        setPhase({
          k: "running",
          course: data.course,
          token: data.token,
          difficulty,
          stake: data.stake,
          restartsLeft: data.restartsLeft,
        });
      } catch {
        setError("Could not reach the server. Nothing was charged.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const onDone = useCallback(
    (result: SubmitResult, difficulty: Difficulty, stake: number) => {
      setPhase({ k: "result", result, difficulty, stake });
      router.refresh();
    },
    [router],
  );

  // ---- running ----
  if (phase.k === "running") {
    const cur = phase;
    return (
      <div className={styles.card}>
        <p className={styles.muted}>
          {LABEL[cur.difficulty]} · {cur.stake.toLocaleString()} staked ·{" "}
          {cur.restartsLeft} retr{cur.restartsLeft === 1 ? "y" : "ies"} left
        </p>
        <GeoRunStage
          key={cur.token}
          course={cur.course}
          token={cur.token}
          sound={sound}
          onDone={(r) => onDone(r, cur.difficulty, cur.stake)}
        />
        <p className={styles.muted}>
          Tap the stage, or press Space / ↑, to jump. Jump orbs slow time — press
          again in the window.
        </p>
      </div>
    );
  }

  // ---- result / death / paywall ----
  if (phase.k === "result") {
    const r = phase.result;
    const { difficulty, stake } = phase;
    const repayCost = difficulty === "impossible" ? stake : state.entry;

    return (
      <div className={styles.card}>
        <div className={styles.resultBlock}>
          {r.ok ? (
            <>
              <strong className={styles.won}>Course cleared</strong>
              {r.devMode ? (
                <p className={styles.muted}>Dev mode — nothing charged or recorded.</p>
              ) : (
                <>
                  <p className={styles.reward}>+{r.payout.toLocaleString()} banked</p>
                  {r.newBalance != null && (
                    <p className={styles.muted}>
                      new balance {r.newBalance.toLocaleString()}
                    </p>
                  )}
                </>
              )}
            </>
          ) : r.outcome === "down" ? (
            <>
              <strong className={styles.lost}>You fell</strong>
              <p className={styles.muted}>
                {Math.round(r.distancePct)}% · {r.restartsLeft} free retr
                {r.restartsLeft === 1 ? "y" : "ies"} left
              </p>
            </>
          ) : r.outcome === "spent" ? (
            <>
              <strong className={styles.lost}>Out of retries</strong>
              <p className={styles.muted}>
                {Math.round(r.distancePct)}% · {r.feesPaid} fee
                {r.feesPaid === 1 ? "" : "s"} paid so far
              </p>
              {!r.devMode && (
                <p className={styles.muted}>
                  Pay the fee again to keep going, or come back tomorrow.
                </p>
              )}
            </>
          ) : r.outcome === "rejected" ? (
            <>
              <strong className={styles.lost}>Run rejected</strong>
              <p className={styles.muted}>{r.reason}</p>
              <p className={styles.muted}>
                The fee was forfeited. If you believe this is a mistake, contact
                an admin.
              </p>
            </>
          ) : (
            <>
              <strong className={styles.lost}>Something went wrong</strong>
              <p className={styles.muted}>{r.reason}</p>
            </>
          )}
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.confirmRow}>
          {r.ok === false && r.outcome === "down" && (
            <button
              className={styles.button}
              disabled={busy}
              onClick={() => {
                armSound();
                void doStart(difficulty, stake);
              }}
            >
              <RotateCcw size={13} /> {busy ? "…" : "Restart"}
            </button>
          )}
          {r.ok === false && r.outcome === "spent" && !r.devMode && (
            <button
              className={`${styles.button} ${difficulty === "impossible" ? styles.buttonDanger : ""}`}
              disabled={busy || (balance != null && balance < repayCost && difficulty !== "impossible")}
              onClick={() => {
                armSound();
                if (difficulty === "impossible") {
                  setStakeInput(String(stake));
                  setPhase({ k: "stake", repay: true });
                } else {
                  setPhase({
                    k: "confirm",
                    difficulty,
                    cost: state.entry,
                    reward: state.entry + state.rewards[difficulty],
                    stake: state.entry,
                    repay: true,
                  });
                }
              }}
            >
              Pay {difficulty === "impossible" ? "again" : repayCost.toLocaleString()} & continue
            </button>
          )}
          {r.ok === false && r.outcome === "spent" && r.devMode && (
            <button
              className={styles.button}
              disabled={busy}
              onClick={() => {
                armSound();
                void doStart(difficulty, stake);
              }}
            >
              <RotateCcw size={13} /> Restart (dev)
            </button>
          )}
          <button
            className={styles.buttonQuiet}
            onClick={() => router.push("/dashboard")}
          >
            Back to trials
          </button>
        </div>
      </div>
    );
  }

  // ---- locked: a run exists for today, difficulty is fixed ----
  if (phase.k === "locked") {
    const cur = phase;
    const started = cur.restartsLeft < state.maxRestarts;
    return (
      <div className={styles.card}>
        <div className={styles.confirm}>
          <p className={styles.confirmTitle}>{LABEL[cur.difficulty]}</p>
          <p className={styles.confirmText}>
            Today&apos;s run is locked to {LABEL[cur.difficulty]} ·{" "}
            {cur.stake.toLocaleString()} staked · {cur.restartsLeft} free retr
            {cur.restartsLeft === 1 ? "y" : "ies"} left.
          </p>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.confirmRow}>
            <button
              className={styles.button}
              disabled={busy}
              onClick={() => {
                armSound();
                void doStart(cur.difficulty, cur.stake);
              }}
            >
              {busy ? "…" : started ? "Continue" : "Play"}
            </button>
            <button
              className={styles.buttonQuiet}
              onClick={() => router.push("/dashboard")}
            >
              Back to trials
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- impossible stake entry (fresh or re-pay) ----
  if (phase.k === "stake") {
    const parsed = Math.floor(Number(stakeInput));
    const valid = Number.isInteger(parsed) && parsed >= state.impossibleMin;
    const overBalance = balance != null && valid && parsed > balance;
    return (
      <div className={styles.card}>
        <div className={styles.stakeForm}>
          <p className={styles.confirmText}>
            {phase.repay ? "Pick a fresh stake to continue." : "Set your stake"} (min{" "}
            {state.impossibleMin.toLocaleString()}, no max). Clear the run for{" "}
            {state.multiplier}× it; fall and it&apos;s gone.
          </p>
          <div className={styles.stakeRow}>
            <input
              className={styles.stakeInput}
              type="number"
              inputMode="numeric"
              min={state.impossibleMin}
              step={100}
              value={stakeInput}
              onChange={(ev) => setStakeInput(ev.target.value)}
            />
            <span className={styles.stakeWins}>
              Reward {(valid ? parsed * state.multiplier : 0).toLocaleString()}
            </span>
          </div>
          {overBalance && (
            <p className={styles.error}>
              That&apos;s more than your {balance!.toLocaleString()} coins.
            </p>
          )}
          <div className={styles.confirmRow}>
            <button
              className={`${styles.button} ${styles.buttonDanger}`}
              disabled={!valid || overBalance}
              onClick={() =>
                setPhase({
                  k: "confirm",
                  difficulty: "impossible",
                  cost: parsed,
                  reward: parsed * state.multiplier,
                  stake: parsed,
                  repay: phase.repay,
                })
              }
            >
              Stake {valid ? parsed.toLocaleString() : state.impossibleMin.toLocaleString()}
            </button>
            <button
              className={styles.buttonQuiet}
              onClick={() => setPhase({ k: "select" })}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- confirm ----
  if (phase.k === "confirm") {
    const { difficulty, cost, reward, stake, repay } = phase;
    return (
      <div className={styles.card}>
        <div className={styles.confirm}>
          <p className={styles.confirmTitle}>{LABEL[difficulty]}</p>
          <div className={styles.confirmFigures}>
            <span>
              <b>Fee</b>
              {cost.toLocaleString()}
            </span>
            <span className={styles.confirmArrow}>→</span>
            <span>
              <b>Reward</b>
              {reward.toLocaleString()}
            </span>
          </div>
          <p className={styles.confirmText}>
            The fee is charged now. Clear the course and the reward lands in your
            bank. You get {state.maxRestarts} free retries per fee — after that
            it&apos;s the fee again to keep going.
          </p>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.confirmRow}>
            <button
              className={`${styles.button} ${difficulty === "impossible" ? styles.buttonDanger : ""}`}
              disabled={busy}
              onClick={() => {
                armSound();
                void doStart(difficulty, stake);
              }}
            >
              {busy ? "Starting…" : repay ? "Pay & continue" : "Pay & start"}
            </button>
            <button
              className={styles.buttonQuiet}
              disabled={busy}
              onClick={() => {
                setError("");
                setPhase({ k: "select" });
              }}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- select ----
  const parsedStake = Math.floor(Number(stakeInput));
  const stakeValid = Number.isInteger(parsedStake) && parsedStake >= state.impossibleMin;

  return (
    <div className={styles.card}>
      <p className={styles.lead}>
        One run a day — pick a difficulty and it&apos;s locked in. Pay the fee,
        hold the jump, and thread the gauntlet. {state.maxRestarts} free retries
        per fee; clear it and the reward lands in your bank.
      </p>

      {state.devMode && (
        <p className={styles.muted}>Dev mode: runs are free and nothing is recorded.</p>
      )}
      {state.run.status === "refunded" && (
        <p className={styles.muted}>
          Your last run was abandoned and the fee was refunded — the day&apos;s run
          is still yours to take.
        </p>
      )}
      {balance != null && (
        <p className={styles.muted}>You have {balance.toLocaleString()} coins.</p>
      )}

      <div className={styles.grid}>
        {TIERS.map((d) => {
          const fr = feeReward(
            d,
            d === "impossible"
              ? stakeValid
                ? parsedStake
                : state.impossibleMin
              : state.entry,
          );
          const tooPoor =
            balance != null && d !== "impossible" && balance < fr.cost;
          return (
            <button
              key={d}
              className={`${styles.tier} ${d === "impossible" ? styles.tierDanger : ""} ${
                tierOpen === d ? styles.tierSelected : ""
              }`}
              disabled={busy || tooPoor}
              onClick={() => {
                setError("");
                if (d === "impossible") {
                  setTierOpen((t) => (t === d ? null : d));
                  return;
                }
                setTierOpen(null);
                setPhase({
                  k: "confirm",
                  difficulty: d,
                  cost: fr.cost,
                  reward: fr.reward,
                  stake: state.entry,
                  repay: false,
                });
              }}
            >
              <span className={styles.tierName}>{LABEL[d]}</span>
              {d === "impossible" ? (
                <span className={styles.tierEcon}>
                  Fee: your stake · Reward: {state.multiplier}× it
                </span>
              ) : (
                <span className={styles.tierEcon}>
                  Fee {fr.cost.toLocaleString()} · Reward {fr.reward.toLocaleString()}
                </span>
              )}
              <span className={styles.tierNet}>
                {tooPoor ? "not enough coins" : "locked for the day"}
              </span>
            </button>
          );
        })}
      </div>

      {tierOpen === "impossible" && (
        <div className={styles.stakeForm}>
          <p className={styles.confirmText}>
            Set your stake (min {state.impossibleMin.toLocaleString()}, no max).
            Clear the run for {state.multiplier}× it; fall and it&apos;s gone.
          </p>
          <div className={styles.stakeRow}>
            <input
              className={styles.stakeInput}
              type="number"
              inputMode="numeric"
              min={state.impossibleMin}
              step={100}
              value={stakeInput}
              onChange={(ev) => setStakeInput(ev.target.value)}
            />
            <span className={styles.stakeWins}>
              Reward{" "}
              {(stakeValid ? parsedStake * state.multiplier : 0).toLocaleString()}
            </span>
          </div>
          {balance != null && stakeValid && parsedStake > balance && (
            <p className={styles.error}>
              That&apos;s more than your {balance.toLocaleString()} coins.
            </p>
          )}
          <button
            className={`${styles.button} ${styles.buttonDanger}`}
            disabled={busy || !stakeValid || (balance != null && parsedStake > balance)}
            onClick={() =>
              setPhase({
                k: "confirm",
                difficulty: "impossible",
                cost: parsedStake,
                reward: parsedStake * state.multiplier,
                stake: parsedStake,
                repay: false,
              })
            }
          >
            Stake{" "}
            {stakeValid
              ? parsedStake.toLocaleString()
              : state.impossibleMin.toLocaleString()}
          </button>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

// ===========================================================================

type Ring = { x: number; y: number; r: number; vr: number; life: number; hue: string };
type Dust = { x: number; y: number; vx: number; vy: number; life: number };
type Shard = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  life: number;
  s: number;
};
type TrailNode = { x: number; y: number; rot: number };

function GeoRunStage({
  course,
  token,
  sound,
  onDone,
}: {
  course: Course;
  token: string;
  sound: SoundKit | null;
  onDone: (r: SubmitResult) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [count, setCount] = useState(3);
  const [status, setStatus] = useState<"count" | "run" | "submitting" | "retry">("count");
  const [err, setErr] = useState("");
  const [muted, setMuted] = useState(sound?.muted ?? true);

  const sRef = useRef<SimState>(initState());
  const consumedRef = useRef<Set<number>>(new Set());
  const submitRef = useRef<() => void>(() => {});
  const pendingRef = useRef<number[]>([]);
  const recordRef = useRef<number[]>([]);
  const lastJumpSimRef = useRef(-1000);
  const orbGateRef = useRef({ inside: false, used: false });
  const lastRef = useRef(0);
  const accRef = useRef(0);
  const doneRef = useRef(false);

  const slowRef = useRef({ orb: -1, elapsed: 0, scale: 1 });
  const zoomRef = useRef(1);
  const rotRef = useRef(0);
  const squashRef = useRef(0);
  const shakeRef = useRef(0);
  const camYRef = useRef(0);
  const beatAccRef = useRef(0);
  const beatIdxRef = useRef(0);
  const beatFlashRef = useRef(0);
  const flashRef = useRef(0);
  const winRef = useRef(0);
  const deadAtRef = useRef(0);
  const trailRef = useRef<TrailNode[]>([]);
  const ringsRef = useRef<Ring[]>([]);
  const dustRef = useRef<Dust[]>([]);
  const shardsRef = useRef<Shard[]>([]);
  const motesRef = useRef<{ x: number; y: number; z: number }[]>([]);

  const reducedRef = useRef(false);
  const palRef = useRef({ gold: "#c8a24c", goldBright: "#ecca77", bg: "#0a0908", bad: "#e0654a" });
  const artRef = useRef<{ far?: HTMLImageElement; mid?: HTMLImageElement; ground?: HTMLImageElement }>({});

  const advanceFx = useCallback((ms: number) => {
    const f = ms / 1000;
    squashRef.current *= Math.pow(0.001, f);
    shakeRef.current *= Math.pow(0.02, f);
    beatFlashRef.current = Math.max(0, beatFlashRef.current - f * 3.2);
    flashRef.current = Math.max(0, flashRef.current - f * 2.4);
    winRef.current = Math.max(0, winRef.current - f * 1.4);

    for (const r of ringsRef.current) {
      r.r += r.vr * f;
      r.life -= f * 2.6;
    }
    ringsRef.current = ringsRef.current.filter((r) => r.life > 0);
    for (const d of dustRef.current) {
      d.x += d.vx * f;
      d.y += d.vy * f;
      d.vy -= 26 * f;
      d.life -= f * 2.4;
    }
    dustRef.current = dustRef.current.filter((d) => d.life > 0);
    for (const sh of shardsRef.current) {
      sh.x += sh.vx * f;
      sh.y += sh.vy * f;
      sh.vy -= 60 * f;
      sh.rot += sh.vr * f;
      sh.life -= f * 1.1;
    }
    shardsRef.current = shardsRef.current.filter((sh) => sh.life > 0);
  }, []);

  const fireEvent = useCallback(
    (ev: GeoEvent) => {
      const s = sRef.current;
      if (ev === "jump") {
        squashRef.current = 0.5;
        ringsRef.current.push({ x: s.x, y: 0, r: 0.3, vr: 9, life: 1, hue: palRef.current.gold });
        sound?.jump();
      } else if (ev === "land") {
        squashRef.current = -0.55;
        shakeRef.current = Math.max(shakeRef.current, 2.4);
        for (let i = 0; i < 6; i++) {
          const a = Math.PI * (0.15 + Math.random() * 0.7);
          dustRef.current.push({
            x: s.x + (Math.random() - 0.5) * 0.6,
            y: 0.1,
            vx: Math.cos(a) * (2 + Math.random() * 3) * (Math.random() < 0.5 ? -1 : 1),
            vy: Math.sin(a) * (2 + Math.random() * 3),
            life: 1,
          });
        }
        sound?.land();
      } else if (ev === "orb") {
        squashRef.current = 0.7;
        ringsRef.current.push({ x: s.x, y: s.y + 0.45, r: 0.4, vr: 13, life: 1.1, hue: palRef.current.goldBright });
        sound?.orb();
      } else if (ev === "pad") {
        squashRef.current = 1;
        shakeRef.current = Math.max(shakeRef.current, 3);
        ringsRef.current.push({ x: s.x, y: 0.1, r: 0.5, vr: 16, life: 1.2, hue: palRef.current.goldBright });
        sound?.pad();
      }
    },
    [sound],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = rect.width;
    const H = rect.height;
    if (W === 0 || H === 0) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pal = palRef.current;
    const rm = reducedRef.current;
    const s = sRef.current;
    const PX = H / 15;
    const groundY = H - PX * 2.4;
    const camX = s.x - 8.5;
    const beat = beatFlashRef.current;
    const slowMix = slowRef.current.orb >= 0 ? Math.min(1, (1 - slowRef.current.scale) / (1 - SLOW_SCALE)) : 0;

    const targetLift = Math.max(0, s.y - 5) * PX * 0.6;
    camYRef.current += (targetLift - camYRef.current) * 0.16;
    const oy = camYRef.current;
    const shk = rm ? 0 : shakeRef.current;
    const shx = shk ? (Math.random() - 0.5) * shk : 0;
    const shy = shk ? (Math.random() - 0.5) * shk : 0;

    const X = (u: number) => (u - camX) * PX + shx;
    const Y = (u: number) => groundY - u * PX + oy + shy;

    // sky
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, W, H);

    const ccx = X(s.x);
    const ccy = Y(s.y) - (course.cube * PX) / 2;

    ctx.save();
    // slow-mo zoom, centred on the cube
    const zoom = zoomRef.current;
    if (zoom !== 1) {
      ctx.translate(ccx, ccy);
      ctx.scale(zoom, zoom);
      ctx.translate(-ccx, -ccy);
    }

    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, `rgba(200,162,76,${0.04 + beat * 0.05 + slowMix * 0.05})`);
    sky.addColorStop(1, "transparent");
    ctx.fillStyle = sky;
    ctx.fillRect(-W, -H, W * 3, groundY + oy + H);

    const art = artRef.current;
    const ready = (i?: HTMLImageElement): i is HTMLImageElement =>
      !!i && i.complete && i.naturalWidth > 0;
    const tile = (img: HTMLImageElement, factor: number, top: number, drawH: number) => {
      const drawW = drawH * (img.naturalWidth / img.naturalHeight);
      let off = -(s.x * PX * factor) % drawW;
      if (off > 0) off -= drawW;
      for (let x = off - drawW; x < W + drawW; x += drawW)
        ctx.drawImage(img, x, top + oy * 0.35, drawW, drawH);
    };
    if (ready(art.far)) tile(art.far, 0.08, 0, (groundY + 4) * 1.02);
    if (ready(art.mid)) tile(art.mid, 0.3, 0, (groundY + 4) * 1.02);

    if (!rm) {
      ctx.fillStyle = "rgba(200,162,76,0.25)";
      for (const m of motesRef.current) {
        const mx = (((m.x - s.x * PX * 0.5 * m.z) % (W + 60)) + W + 60) % (W + 60) - 30;
        ctx.globalAlpha = 0.1 + m.z * 0.25;
        ctx.fillRect(mx, m.y + Math.sin(s.t * m.z + m.x) * 6 + oy * 0.4, 2, 2);
      }
      ctx.globalAlpha = 1;
    }

    // ground
    if (ready(art.ground)) {
      const bandH = H - groundY + oy + 40;
      const tileW = bandH * (art.ground.naturalWidth / art.ground.naturalHeight);
      let off = -(s.x * PX) % tileW;
      if (off > 0) off -= tileW;
      for (let x = off - tileW; x < W + tileW; x += tileW)
        ctx.drawImage(art.ground, x, groundY + oy, tileW, bandH);
      ctx.fillStyle = "rgba(10,9,8,0.4)";
      ctx.fillRect(-W, groundY + oy, W * 3, bandH);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.02)";
      ctx.fillRect(-W, groundY + oy, W * 3, H);
    }
    ctx.strokeStyle = pal.gold;
    ctx.lineWidth = 2 + beat * 2;
    ctx.shadowColor = pal.gold;
    ctx.shadowBlur = rm ? 0 : 12 + beat * 18;
    ctx.globalAlpha = 0.7 + beat * 0.3;
    ctx.beginPath();
    ctx.moveTo(-W, groundY + oy + shy + 1);
    ctx.lineTo(W * 2, groundY + oy + shy + 1);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    const metal = (x0: number, y0: number, x1: number, y1: number) => {
      const g = ctx.createLinearGradient(x0, y0, x0, y1);
      g.addColorStop(0, "#3a2f1c");
      g.addColorStop(0.5, "#221b10");
      g.addColorStop(1, "#0d0a06");
      return g;
    };

    // obstacles
    for (let i = 0; i < course.obstacles.length; i++) {
      const o = course.obstacles[i];
      if (X(o.x) > W + 160 || X(o.x) < -160) continue;

      if (o.t === "spike") {
        const units = Math.max(1, Math.round(o.w / 0.9));
        for (let k = 0; k < units; k++) {
          const x0 = X(o.x) + k * 0.9 * PX;
          const grad = ctx.createLinearGradient(x0, Y(o.h), x0, Y(0));
          grad.addColorStop(0, pal.goldBright);
          grad.addColorStop(0.35, "#7a5f28");
          grad.addColorStop(1, "#141009");
          ctx.fillStyle = grad;
          ctx.strokeStyle = pal.gold;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(x0, Y(0));
          ctx.lineTo(x0 + 0.45 * PX, Y(o.h));
          ctx.lineTo(x0 + 0.9 * PX, Y(0));
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      } else if (o.t === "block") {
        const bx = X(o.x);
        const bw = o.w * PX;
        const by = Y(o.h);
        const bh = Y(0) - by;
        ctx.fillStyle = metal(bx, by, bx, by + bh);
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = pal.gold;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
        ctx.strokeStyle = "rgba(236,202,119,0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx + 1, by + 1);
        ctx.lineTo(bx + bw - 1, by + 1);
        ctx.stroke();
      } else if (o.t === "ceil") {
        const bx = X(o.x);
        const bw = o.w * PX;
        const teethBase = Y(o.y + 0.75);
        const tip = Y(o.y);
        ctx.fillStyle = metal(bx, Y(o.y + 2.4), bx, teethBase);
        ctx.fillRect(bx, Y(o.y + 2.4), bw, teethBase - Y(o.y + 2.4));
        ctx.strokeStyle = pal.gold;
        ctx.lineWidth = 1.4;
        const teeth = Math.max(1, Math.round(o.w / 0.9));
        for (let k = 0; k < teeth; k++) {
          const tx = bx + (k * bw) / teeth;
          const tw = bw / teeth;
          ctx.fillStyle = metal(tx, teethBase, tx, tip);
          ctx.beginPath();
          ctx.moveTo(tx, teethBase);
          ctx.lineTo(tx + tw / 2, tip);
          ctx.lineTo(tx + tw, teethBase);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        ctx.strokeStyle = "rgba(236,202,119,0.6)";
        ctx.beginPath();
        ctx.moveTo(bx, teethBase);
        ctx.lineTo(bx + bw, teethBase);
        ctx.stroke();
      } else if (o.t === "float") {
        const fx = X(o.x);
        const fw = o.w * PX;
        const ty = Y(o.y + o.h);
        const fh = Y(o.y) - ty;
        // suspension line
        ctx.strokeStyle = "rgba(200,162,76,0.3)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(fx + fw / 2, ty);
        ctx.lineTo(fx + fw / 2, ty - PX * 3);
        ctx.stroke();
        ctx.fillStyle = metal(fx, ty, fx, ty + fh);
        ctx.fillRect(fx, ty, fw, fh);
        ctx.strokeStyle = pal.gold;
        ctx.lineWidth = 1.6;
        ctx.shadowColor = pal.gold;
        ctx.shadowBlur = rm ? 0 : 8;
        ctx.strokeRect(fx + 0.5, ty + 0.5, fw - 1, fh - 1);
        ctx.shadowBlur = 0;
      } else if (o.t === "mover") {
        const p = moverPos(o, s.t);
        const mx = X(p.x);
        const mw = o.w * PX;
        const ty = Y(p.y + o.h);
        const mh = Y(p.y) - ty;
        // track
        ctx.strokeStyle = "rgba(200,162,76,0.16)";
        ctx.setLineDash([4, 5]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (o.ax === "y") {
          ctx.moveTo(X(o.x) + mw / 2, Y(o.y - o.amp));
          ctx.lineTo(X(o.x) + mw / 2, Y(o.y + o.amp + o.h));
        } else {
          ctx.moveTo(X(o.x - o.amp) + mw / 2, Y(o.y + o.h / 2));
          ctx.lineTo(X(o.x + o.amp) + mw / 2, Y(o.y + o.h / 2));
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = metal(mx, ty, mx, ty + mh);
        ctx.fillRect(mx, ty, mw, mh);
        ctx.strokeStyle = pal.goldBright;
        ctx.lineWidth = 1.8;
        ctx.shadowColor = pal.gold;
        ctx.shadowBlur = rm ? 0 : 10;
        ctx.strokeRect(mx + 0.5, ty + 0.5, mw - 1, mh - 1);
        ctx.shadowBlur = 0;
      } else if (o.t === "rotor") {
        const hx = X(o.x);
        const hy = Y(o.y);
        ctx.strokeStyle = "rgba(200,162,76,0.12)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(hx, hy, o.r * PX, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = pal.goldBright;
        ctx.lineWidth = Math.max(3, PX * 0.28);
        ctx.lineCap = "round";
        ctx.shadowColor = pal.gold;
        ctx.shadowBlur = rm ? 0 : 12;
        for (const ang of rotorAngles(o, s.t)) {
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.lineTo(hx + Math.cos(ang) * o.r * PX, hy - Math.sin(ang) * o.r * PX);
          ctx.stroke();
        }
        ctx.lineCap = "butt";
        ctx.shadowBlur = 0;
        ctx.fillStyle = pal.gold;
        ctx.beginPath();
        ctx.arc(hx, hy, o.hub * PX + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#141009";
        ctx.beginPath();
        ctx.arc(hx, hy, o.hub * PX * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (o.t === "orb") {
        const cx = X(o.x);
        const cy = Y(o.y);
        const used = consumedRef.current.has(i);
        const near =
          !used &&
          Math.hypot(s.x - o.x, s.y + course.cube / 2 - o.y) < ORB_RADIUS + 0.3;
        const pulse = used ? 0.4 : 0.8 + Math.sin(s.t * 6) * 0.2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(s.t * (used ? 0.4 : 2.2));
        ctx.strokeStyle = used ? "rgba(120,110,90,0.5)" : near ? pal.goldBright : pal.gold;
        ctx.lineWidth = near ? 3 : 2;
        ctx.shadowColor = pal.gold;
        ctx.shadowBlur = rm || used ? 0 : near ? 22 : 10;
        ctx.beginPath();
        ctx.arc(0, 0, ORB_RADIUS * PX * 0.62 * pulse, 0.6, Math.PI * 1.4);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, ORB_RADIUS * PX * 0.4 * pulse, Math.PI + 0.6, Math.PI * 2.4);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = used ? "rgba(120,110,90,0.5)" : pal.goldBright;
        ctx.beginPath();
        ctx.arc(0, 0, PX * 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        if (near && slowRef.current.orb === i) {
          ctx.fillStyle = pal.goldBright;
          ctx.font = "700 12px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.fillText("JUMP", cx, cy - ORB_RADIUS * PX - 4);
          ctx.textAlign = "left";
        }
      } else if (o.t === "pad") {
        const cx = X(o.x);
        const gy = Y(o.y);
        const used = consumedRef.current.has(i);
        ctx.fillStyle = used ? "rgba(120,110,90,0.5)" : pal.goldBright;
        ctx.strokeStyle = pal.gold;
        ctx.shadowColor = pal.gold;
        ctx.shadowBlur = rm || used ? 0 : 14;
        ctx.beginPath();
        ctx.moveTo(cx - PAD_RADIUS * PX, gy);
        ctx.lineTo(cx, gy - PX * 0.7);
        ctx.lineTo(cx + PAD_RADIUS * PX, gy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    // finish line
    const fx = X(course.length);
    if (fx < W + 40 && fx > -40) {
      ctx.strokeStyle = pal.goldBright;
      ctx.lineWidth = 3;
      ctx.setLineDash([9, 7]);
      ctx.shadowColor = pal.gold;
      ctx.shadowBlur = rm ? 0 : 16;
      ctx.beginPath();
      ctx.moveTo(fx, Y(0));
      ctx.lineTo(fx, Y(9));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    }

    // rings / dust
    for (const r of ringsRef.current) {
      ctx.globalAlpha = Math.max(0, r.life) * 0.5;
      ctx.strokeStyle = r.hue;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(r.x), Y(r.y), r.r * PX, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.gold;
    for (const d of dustRef.current) {
      ctx.globalAlpha = Math.max(0, d.life) * 0.6;
      ctx.fillRect(X(d.x) - 1.5, Y(d.y) - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;

    // cube / shards
    const size = course.cube * PX;
    if (shardsRef.current.length) {
      for (const sh of shardsRef.current) {
        ctx.save();
        ctx.translate(X(sh.x), Y(sh.y));
        ctx.rotate(sh.rot);
        ctx.globalAlpha = Math.max(0, Math.min(1, sh.life));
        ctx.fillStyle = "#141009";
        ctx.strokeStyle = pal.goldBright;
        ctx.lineWidth = 1.5;
        const hs = sh.s * PX;
        ctx.fillRect(-hs / 2, -hs / 2, hs, hs);
        ctx.strokeRect(-hs / 2, -hs / 2, hs, hs);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    } else if (!doneRef.current || winRef.current > 0) {
      if (!rm) {
        const aura = ctx.createRadialGradient(ccx, ccy, 0, ccx, ccy, size * (1.8 + beat + slowMix));
        aura.addColorStop(0, `rgba(236,202,119,${0.22 + beat * 0.2 + slowMix * 0.2})`);
        aura.addColorStop(1, "transparent");
        ctx.fillStyle = aura;
        ctx.fillRect(ccx - size * 4, ccy - size * 4, size * 8, size * 8);
      }
      for (let t = 0; t < trailRef.current.length; t++) {
        const n = trailRef.current[t];
        const k = (t + 1) / (trailRef.current.length + 1);
        ctx.save();
        ctx.translate(X(n.x), Y(n.y) - size / 2);
        ctx.rotate(n.rot);
        ctx.globalAlpha = k * 0.28;
        ctx.fillStyle = pal.gold;
        const q = size * (0.5 + k * 0.4);
        ctx.fillRect(-q / 2, -q / 2, q, q);
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      const sq = squashRef.current;
      ctx.save();
      ctx.translate(ccx, ccy);
      if (!rm) ctx.rotate(rotRef.current);
      ctx.scale(1 - sq * 0.35, 1 + sq * 0.35);
      const g = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
      g.addColorStop(0, "#26200f");
      g.addColorStop(1, "#0d0b07");
      ctx.fillStyle = g;
      ctx.strokeStyle = pal.goldBright;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = pal.gold;
      ctx.shadowBlur = rm ? 0 : 12 + beat * 10 + slowMix * 14;
      const h = size / 2;
      const rr = size * 0.16;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(-h, -h, size, size, rr);
      else ctx.rect(-h, -h, size, size);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = pal.goldBright;
      ctx.save();
      ctx.rotate(Math.PI / 4);
      const d = size * 0.24;
      ctx.fillRect(-d, -d, d * 2, d * 2);
      ctx.restore();
      ctx.restore();
    }

    ctx.restore(); // end zoom

    // screen-space overlays
    if (slowMix > 0.01) {
      const vg = ctx.createRadialGradient(ccx, ccy, H * 0.15, ccx, ccy, H * 0.9);
      vg.addColorStop(0, "transparent");
      vg.addColorStop(1, `rgba(4,10,20,${slowMix * 0.5})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
    if (flashRef.current > 0) {
      ctx.fillStyle = `rgba(255,248,232,${flashRef.current * 0.8})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (winRef.current > 0) {
      ctx.save();
      ctx.globalAlpha = winRef.current * 0.5;
      ctx.strokeStyle = pal.goldBright;
      ctx.lineWidth = 3;
      ctx.translate(ccx, ccy);
      for (let a = 0; a < 12; a++) {
        ctx.rotate(Math.PI / 6);
        ctx.beginPath();
        ctx.moveTo(size, 0);
        ctx.lineTo(size + (1 - winRef.current) * 120 + 30, 0);
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    const p = Math.min(1, s.x / course.length);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(0, 0, W, 5);
    ctx.fillStyle = pal.gold;
    ctx.fillRect(0, 0, W * p, 5);
    ctx.fillStyle = pal.goldBright;
    ctx.shadowColor = pal.gold;
    ctx.shadowBlur = 10;
    ctx.fillRect(W * p - 2, 0, 4, 5);
    ctx.shadowBlur = 0;
    ctx.font = "600 11px ui-monospace, monospace";
    ctx.fillStyle = "rgba(239,232,215,0.75)";
    ctx.textAlign = "right";
    ctx.fillText(`${Math.floor(p * 100)}%`, W - 8, 18);
    ctx.textAlign = "left";

    if (!rm) {
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
      vg.addColorStop(0, "transparent");
      vg.addColorStop(1, "rgba(0,0,0,0.4)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
  }, [course]);

  // palette + art + countdown → run
  useEffect(() => {
    reducedRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cs = getComputedStyle(document.documentElement);
    const g = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
    palRef.current = {
      gold: g("--gold", "#c8a24c"),
      goldBright: g("--gold-bright", "#ecca77"),
      bg: g("--bg", "#0a0908"),
      bad: g("--bad-bright", "#e0654a"),
    };
    motesRef.current = Array.from({ length: 26 }, () => ({
      x: Math.random() * 2000,
      y: Math.random() * 320,
      z: 0.2 + Math.random() * 0.8,
    }));

    const load = (src: string) => {
      const img = new Image();
      img.src = src;
      img.onload = () => draw();
      return img;
    };
    artRef.current = {
      far: load("/geodash/bg-far.webp"),
      mid: load("/geodash/bg-mid.webp"),
      ground: load("/geodash/ground.webp"),
    };

    draw();
    let n = 3;
    const id = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        window.clearInterval(id);
        setCount(0);
        setStatus("run");
      } else {
        setCount(n);
      }
    }, 620);
    return () => window.clearInterval(id);
  }, [draw]);

  // the run
  useEffect(() => {
    if (status !== "run") return;
    const stage = wrapRef.current;
    if (!stage) return;

    sRef.current = initState();
    consumedRef.current = new Set();
    pendingRef.current = [];
    recordRef.current = [];
    lastJumpSimRef.current = -1000;
    orbGateRef.current = { inside: false, used: false };
    slowRef.current = { orb: -1, elapsed: 0, scale: 1 };
    zoomRef.current = 1;
    rotRef.current = 0;
    squashRef.current = 0;
    shakeRef.current = 0;
    camYRef.current = 0;
    beatAccRef.current = 0;
    beatIdxRef.current = 0;
    beatFlashRef.current = 0;
    flashRef.current = 0;
    winRef.current = 0;
    deadAtRef.current = 0;
    trailRef.current = [];
    ringsRef.current = [];
    dustRef.current = [];
    shardsRef.current = [];
    doneRef.current = false;
    accRef.current = 0;
    const t0 = performance.now();
    lastRef.current = t0;
    sound?.resume();

    let raf = 0;
    let submitted = false;
    const airtime = (2 * course.jumpV) / course.gravity;
    const stepMs = SIM_DT * 1000;
    const beatMs = 60000 / (course.bpm || 120);
    const cubeHalf = course.cube / 2;

    const attempt = async () => {
      try {
        const res = await fetch("/api/geodash/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            jumpTimes: recordRef.current,
            totalMs: sRef.current.t * 1000,
          }),
        });
        const data = (await res.json()) as SubmitResult;
        if (!res.ok && res.status !== 400) {
          setErr(
            res.status === 429
              ? "Slow down a moment, then retry."
              : "The run didn't save — retry to send it.",
          );
          setStatus("retry");
          return;
        }
        onDone(data);
      } catch {
        setErr("Network error — retry to send the run.");
        setStatus("retry");
      }
    };
    submitRef.current = () => {
      setStatus("submitting");
      setErr("");
      void attempt();
    };
    const send = () => {
      if (submitted) return;
      submitted = true;
      setStatus("submitting");
      setErr("");
      void attempt();
    };

    const spawnShatter = () => {
      const st = sRef.current;
      shardsRef.current = [];
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 3 + Math.random() * 9;
        shardsRef.current.push({
          x: st.x + (Math.random() - 0.5) * 0.6,
          y: st.y + cubeHalf + (Math.random() - 0.5) * 0.6,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp + 4,
          rot: Math.random() * 6,
          vr: (Math.random() - 0.5) * 18,
          life: 0.8 + Math.random() * 0.5,
          s: 0.12 + Math.random() * 0.22,
        });
      }
      flashRef.current = 1;
      shakeRef.current = 9;
      sound?.die();
    };

    const inAnyOrb = (st: SimState) => {
      for (const o of course.obstacles) {
        if (o.t !== "orb") continue;
        const dx = st.x - o.x;
        const dy = st.y + cubeHalf - o.y;
        if (dx * dx + dy * dy <= ORB_RADIUS * ORB_RADIUS) return true;
      }
      return false;
    };

    const loop = () => {
      const now = performance.now();
      let frameMs = now - lastRef.current;
      lastRef.current = now;
      if (frameMs > 200) frameMs = 200;

      advanceFx(frameMs);

      // slow-motion time scale
      const sm = slowRef.current;
      let scaleTarget = 1;
      if (sm.orb >= 0) {
        sm.elapsed += frameMs;
        const resolved =
          consumedRef.current.has(sm.orb) || sm.elapsed >= SLOWMO_WINDOW_MS;
        if (resolved) {
          consumedRef.current.add(sm.orb); // missed → resolved so it won't re-trigger
          scaleTarget = 1;
          if (sm.scale > 0.985) sm.orb = -1;
        } else {
          scaleTarget = SLOW_SCALE;
        }
      }
      sm.scale += (scaleTarget - sm.scale) * Math.min(1, frameMs / SLOWMO_EASE_MS);
      zoomRef.current +=
        ((sm.orb >= 0 && scaleTarget < 1 ? 1.34 : 1) - zoomRef.current) *
        Math.min(1, frameMs / 170);

      if (status === "run" && !doneRef.current && !submitted) {
        beatAccRef.current += frameMs;
        while (beatAccRef.current >= beatMs) {
          beatAccRef.current -= beatMs;
          const idx = beatIdxRef.current++;
          sound?.beat(idx % 4 === 0);
          beatFlashRef.current = idx % 4 === 0 ? 1 : 0.4;
        }
      }

      accRef.current += frameMs * sm.scale;
      const s = sRef.current;
      let ended: "dead" | "clear" | null = null;

      while (accRef.current >= stepMs) {
        const stepEndMs = (s.t + SIM_DT) * 1000;
        let jump = false;
        while (pendingRef.current.length && pendingRef.current[0] <= stepEndMs) {
          jump = true;
          pendingRef.current.shift();
        }
        const wasGround = s.onGround;
        step(s, course, jump, consumedRef.current);
        accRef.current -= stepMs;

        if (s.event) fireEvent(s.event);

        // orb-radius gate + slow-mo trigger
        const inside = inAnyOrb(s);
        if (!inside) orbGateRef.current.used = false;
        orbGateRef.current.inside = inside;
        if (sm.orb < 0) {
          for (let i = 0; i < course.obstacles.length; i++) {
            const o = course.obstacles[i];
            if (o.t !== "orb" || consumedRef.current.has(i)) continue;
            const dx = s.x - o.x;
            const dy = s.y + cubeHalf - o.y;
            if (dx * dx + dy * dy <= ORB_RADIUS * ORB_RADIUS) {
              sm.orb = i;
              sm.elapsed = 0;
              sound?.slow();
              break;
            }
          }
        }

        if (!s.onGround) rotRef.current += (Math.PI / airtime) * SIM_DT;
        else if (!wasGround)
          rotRef.current = Math.round(rotRef.current / (Math.PI / 2)) * (Math.PI / 2);

        if (hits(course, s.x, s.y, s.t)) {
          ended = "dead";
          break;
        }
        if (s.x >= course.length) {
          ended = "clear";
          break;
        }
      }

      if (!s.onGround && !doneRef.current) {
        trailRef.current.push({ x: s.x, y: s.y, rot: rotRef.current });
        if (trailRef.current.length > 14) trailRef.current.shift();
      } else if (trailRef.current.length) {
        trailRef.current.shift();
      }

      draw();

      if (ended === "dead") {
        doneRef.current = true;
        deadAtRef.current = performance.now();
        spawnShatter();
        const burst = () => {
          const t = performance.now();
          advanceFx(Math.min(60, t - lastRef.current));
          lastRef.current = t;
          draw();
          if (t - deadAtRef.current < 780) raf = requestAnimationFrame(burst);
          else send();
        };
        raf = requestAnimationFrame(burst);
        return;
      }
      if (ended === "clear") {
        doneRef.current = true;
        winRef.current = 1;
        sound?.win();
        const cheer = () => {
          const t = performance.now();
          advanceFx(Math.min(60, t - lastRef.current));
          lastRef.current = t;
          draw();
          if (winRef.current > 0.02) raf = requestAnimationFrame(cheer);
          else send();
        };
        raf = requestAnimationFrame(cheer);
        return;
      }
      raf = requestAnimationFrame(loop);
    };

    const jump = () => {
      if (doneRef.current) return;
      const simTs = sRef.current.t * 1000;
      if (simTs - lastJumpSimRef.current < 60) return;
      if (orbGateRef.current.inside && orbGateRef.current.used) return;
      lastJumpSimRef.current = simTs;
      pendingRef.current.push(simTs);
      recordRef.current.push(simTs);
      if (orbGateRef.current.inside) orbGateRef.current.used = true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        e.preventDefault();
        jump();
      }
    };
    window.addEventListener("keydown", onKey);
    stage.addEventListener("pointerdown", jump);

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      stage.removeEventListener("pointerdown", jump);
    };
  }, [status, course, token, onDone, draw, sound, advanceFx, fireEvent]);

  return (
    <div className={styles.stage} ref={wrapRef}>
      <canvas ref={canvasRef} className={styles.canvas} />

      {sound && (
        <button
          type="button"
          className={styles.muteBtn}
          aria-label={muted ? "Unmute" : "Mute"}
          onClick={(e) => {
            e.stopPropagation();
            sound.resume();
            setMuted(sound.toggle());
          }}
        >
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
      )}

      {status === "count" && (
        <div className={styles.overlay}>
          <span className={styles.count}>{count > 0 ? count : "GO"}</span>
        </div>
      )}
      {status === "run" && <p className={styles.tapHint}>tap / space to jump</p>}
      {status === "submitting" && (
        <div className={styles.overlay}>
          <span className={styles.count} style={{ fontSize: 22 }}>
            saving…
          </span>
        </div>
      )}
      {status === "retry" && (
        <div className={styles.overlay} style={{ pointerEvents: "auto" }}>
          <div className={styles.retryBox}>
            <p className={styles.error}>{err}</p>
            <button className={styles.button} onClick={() => submitRef.current()}>
              Retry save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
