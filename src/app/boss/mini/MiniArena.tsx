"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Users, Swords, Timer } from "lucide-react";
import type { BossState } from "@/lib/boss/types";
import { AdminBar, BossPortrait, Leaderboard, fmtDuration } from "../shared";
import { MiniTyping } from "./MiniTyping";
import { MiniAim } from "./MiniAim";
import { MiniLitany } from "./MiniLitany";
import styles from "../boss.module.css";

const POLL_MS = 5000;

type Game = "typing" | "aim" | "litany";
type Session = {
  game: Game;
  token: string;
  content: unknown;
  config: Record<string, number>;
};
type Result =
  | { ok: true; dmg: number; metric: number; game: Game }
  | { ok: false; reason: string };

const CARDS: { game: Game; title: string; blurb: string }[] = [
  { game: "typing", title: "Transcription", blurb: "Copy the verse as it unspools." },
  { game: "aim", title: "Trial of Aim", blurb: "Strike each mote before the light fails." },
  { game: "litany", title: "The Litany", blurb: "Read the rite, then recite it back." },
];

const METRIC_LABEL: Record<Game, (m: number) => string> = {
  typing: (m) => `${m} WPM`,
  aim: (m) => `${m}ms/strike`,
  litany: (m) => `round ${m}`,
};

export function MiniArena({ initial }: { initial: BossState }) {
  const [server, setServer] = useState(initial);
  const [now, setNow] = useState(() => Date.parse(initial.spawnsAt));
  const [session, setSession] = useState<Session | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const serverRef = useRef(server);
  const sessionRef = useRef<Session | null>(session);
  useEffect(() => {
    serverRef.current = server;
    sessionRef.current = session;
  });

  useEffect(() => {
    if (!server.mini || server.status !== "active" || server.slain) {
      window.location.reload();
    }
  }, [server.mini, server.status, server.slain]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    async function poll() {
      if (sessionRef.current) return; // don't disturb a run in progress
      try {
        const res = await fetch("/api/boss", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const next = (await res.json()) as BossState;
        setServer((prev) => ({
          ...next,
          hp: Math.min(prev.hp, next.hp),
          dealt: Math.max(prev.dealt, next.dealt),
        }));
      } catch {
        /* transient */
      }
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const cd = server.yourCooldownUntil ?? 0;
  const cooling = cd > now;

  const start = useCallback(
    async (game: Game) => {
      if (busy || sessionRef.current) return;
      setBusy(true);
      setResult(null);
      try {
        const res = await fetch(`/api/boss/mini/${game}/start`, { method: "POST" });
        const data = await res.json();
        if (data.ok) {
          setSession({
            game,
            token: data.token,
            content: data.content,
            config: data.config ?? {},
          });
        } else {
          setResult({ ok: false, reason: data.reason ?? "Not right now." });
          if (typeof data.cooldownUntil === "number") {
            setServer((s) => ({ ...s, yourCooldownUntil: data.cooldownUntil }));
          }
        }
      } catch {
        setResult({ ok: false, reason: "The trial wouldn't open." });
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const submit = useCallback(async (payload: Record<string, unknown>) => {
    const s = sessionRef.current;
    if (!s) return;
    setSession(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/boss/mini/${s.game}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: s.token, ...payload }),
      });
      const data = await res.json();
      if (data.state) setServer(data.state as BossState);
      setResult(
        data.ok
          ? { ok: true, dmg: data.dmg, metric: data.metric, game: s.game }
          : { ok: false, reason: data.reason ?? "The trial slipped away." },
      );
    } catch {
      setResult({ ok: false, reason: "Lost contact mid-trial." });
    } finally {
      setBusy(false);
    }
  }, []);

  const cancel = useCallback(() => setSession(null), []);

  const hpPct = Math.max(0, Math.min(100, (server.hp / server.maxHp) * 100));
  const expiresIn = Date.parse(server.expiresAt) - now;

  // ---------- a trial in progress ----------
  if (session) {
    let surface: React.ReactNode = null;
    if (session.game === "typing") {
      const c = session.content as { text: string };
      surface = <MiniTyping text={c.text} onDone={submit} onCancel={cancel} />;
    } else if (session.game === "aim") {
      const c = session.content as {
        targets: { x: number; y: number }[];
        radius: number;
        count: number;
      };
      surface = (
        <MiniAim
          targets={c.targets}
          radius={c.radius}
          count={c.count}
          timeLimitMs={session.config.timeLimitMs ?? 7000}
          onDone={submit}
          onCancel={cancel}
        />
      );
    } else {
      const c = session.content as { sequence: number[]; glyphs: number };
      surface = (
        <MiniLitany
          sequence={c.sequence}
          glyphs={c.glyphs}
          flashOnMs={session.config.flashOnMs ?? 460}
          flashGapMs={session.config.flashGapMs ?? 200}
          onDone={submit}
          onCancel={cancel}
        />
      );
    }

    return (
      <div className={styles.card}>
        <h1 className={styles.name}>{server.name}</h1>
        <div className={styles.hpWrap}>
          <div className={styles.hpBar}>
            <div
              className={styles.hpFill}
              style={{ width: `${hpPct}%` }}
              data-low={hpPct < 25 || undefined}
            />
          </div>
          <div className={styles.hpText}>
            <span className="mono">
              {Math.ceil(server.hp).toLocaleString()} /{" "}
              {server.maxHp.toLocaleString()}
            </span>
            <span className="mono">{Math.round(hpPct)}%</span>
          </div>
        </div>
        {surface}
      </div>
    );
  }

  // ---------- the reliquary (menu) ----------
  return (
    <div className={styles.card}>
      <p className="eyebrow">
        {server.adminOnly
          ? "Test Raid — admins only"
          : "The Weekly Raid — fight now"}
      </p>
      <h1 className={styles.name}>{server.name}</h1>
      {(server.adminOnly || !server.paysOut) && (
        <p className={styles.testFlag}>
          {server.adminOnly && "Only admins can see this fight. "}
          {!server.paysOut && "No coins are paid out for it."}
        </p>
      )}
      <AdminBar show={server.viewerIsAdmin} active />

      <div className={styles.hpWrap}>
        <div className={styles.hpBar}>
          <div
            className={styles.hpFill}
            style={{ width: `${hpPct}%` }}
            data-low={hpPct < 25 || undefined}
          />
        </div>
        <div className={styles.hpText}>
          <span className="mono">
            {Math.ceil(server.hp).toLocaleString()} /{" "}
            {server.maxHp.toLocaleString()}
          </span>
          <span className="mono">{Math.round(hpPct)}%</span>
        </div>
      </div>

      <BossPortrait image={server.image} name={server.name} dimmed />

      <p className={styles.sub}>
        {server.blurb ||
          "Undo him through the reliquary trials. Harder trials tear deeper."}
      </p>

      {result && (
        <p
          className={`${styles.miniResult} ${
            result.ok ? styles.won : styles.lost
          }`}
        >
          {result.ok
            ? `${METRIC_LABEL[result.game](result.metric)} — ${
                result.dmg > 0 ? `tore ${result.dmg} from him` : "no damage that time"
              }.`
            : result.reason}
        </p>
      )}

      <div className={styles.miniCards}>
        {CARDS.map((c) => (
          <button
            key={c.game}
            type="button"
            className={styles.miniCard}
            disabled={busy || cooling}
            onClick={() => start(c.game)}
          >
            <span className={styles.miniCardTitle}>{c.title}</span>
            <span className={styles.miniCardBlurb}>{c.blurb}</span>
          </button>
        ))}
      </div>

      {cooling && (
        <p className={styles.miniCd}>
          Next trial in {Math.max(0, Math.ceil((cd - now) / 1000))}s
        </p>
      )}

      <div className={styles.stats}>
        <span className="rune">
          <Swords size={14} /> {Math.round(server.yourDamage).toLocaleString()}
        </span>
        <span className="rune">
          <Users size={14} /> {server.participants}
        </span>
        <span className="rune">
          <Timer size={14} /> {fmtDuration(expiresIn)}
        </span>
      </div>

      <p className={styles.sub}>
        Bounty pool {server.rewardPool.toLocaleString()} coins, split by damage.
        Everyone who fights and loses forfeits{" "}
        {server.penaltyEach.toLocaleString()}.
      </p>

      <Leaderboard top={server.top} />
    </div>
  );
}
