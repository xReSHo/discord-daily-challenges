"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BossState } from "@/lib/boss/types";
import { THREADS, keepsThread, threadsMult } from "@/lib/boss/mechanics/combo";
import { BossPortrait, ComboBand, Stage } from "../shared";
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
  | { ok: true; dmg: number; mult: number; metric: number; game: Game }
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
          ? { ok: true, dmg: data.dmg, mult: data.mult ?? 1, metric: data.metric, game: s.game }
          : { ok: false, reason: data.reason ?? "The trial slipped away." },
      );
    } catch {
      setResult({ ok: false, reason: "Lost contact mid-trial." });
    } finally {
      setBusy(false);
    }
  }, []);

  const cancel = useCallback(() => setSession(null), []);

  const expiresIn = Date.parse(server.expiresAt) - now;

  // the thread: trials passed in a row, none of them one of the last two
  const thread = server.combo?.kind === "threads" ? server.combo : { chain: 0, recent: [] };
  const lastTitle = (g: string) => CARDS.find((c) => c.game === g)?.title ?? g;

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
      <Stage
        state={server}
        eyebrow="The Weekly Raid — a trial is open"
        hp={server.hp}
        mine={server.yourDamage}
        clock={{ label: "Ends in", ms: expiresIn }}
        focus
      >
        <div className={styles.miniPanel}>{surface}</div>
      </Stage>
    );
  }

  // ---------- the reliquary (menu) ----------
  return (
    <Stage
      state={server}
      eyebrow={server.adminOnly ? "Test Raid — admins only" : "The Weekly Raid — fight now"}
      hp={server.hp}
      mine={server.yourDamage}
      clock={{ label: "Ends in", ms: expiresIn }}
      notice={
        <>
      {result && (
        <p
          className={`${styles.miniResult} ${
            result.ok ? styles.won : styles.lost
          }`}
        >
          {result.ok
            ? `${METRIC_LABEL[result.game](result.metric)} — ${
                result.dmg > 0
                  ? `tore ${result.dmg} from him${result.mult > 1 ? ` (×${result.mult} thread)` : ""}`
                  : "no damage that time"
              }.`
            : result.reason}
        </p>
      )}

      <ComboBand
        tone="threads"
        label={
          <>
            <b>{thread.chain}</b> thread{thread.chain === 1 ? "" : "s"}
          </>
        }
        pips={{ lit: thread.chain, of: THREADS.max }}
        mult={threadsMult(thread.chain)}
        note="next trial"
        live={thread.chain > 0}
        peak={thread.chain >= THREADS.max}
        hint={
          thread.recent.length === 0 ? (
            <>Pass a trial to pull the first thread. Never repeat either of your last two.</>
          ) : (
            <>
              Your last two: <b>{thread.recent.map(lastTitle).join(", ")}</b>. Repeat one, or fail,
              and the thread is cut.
            </>
          )
        }
      />

      <div className={styles.miniCards}>
        {CARDS.map((c) => {
          const keeps = keepsThread(thread.recent, c.game);
          return (
            <button
              key={c.game}
              type="button"
              className={`${styles.miniCard} ${keeps ? "" : styles.miniCardCut}`}
              disabled={busy || cooling}
              onClick={() => start(c.game)}
            >
              <span className={styles.miniCardTitle}>{c.title}</span>
              <span className={styles.miniCardBlurb}>{c.blurb}</span>
              {thread.recent.length > 0 && (
                <span className={styles.miniCardNote}>
                  {keeps ? "keeps the thread" : "cuts the thread"}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {cooling && (
        <p className={styles.miniCd}>
          Next trial in {Math.max(0, Math.ceil((cd - now) / 1000))}s
        </p>
      )}
        </>
      }
    >
      <BossPortrait image={server.image} name={server.name} dimmed />
    </Stage>
  );
}
