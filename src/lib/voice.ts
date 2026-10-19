import { sfxOn, watchSfx } from "@/lib/sfx";
import { level, watchLevels } from "@/lib/sound-levels";
import { setRoomsLevel, silenceRooms, throughRoom, type Room } from "@/lib/voice-fx";

/**
 * Spoken lines (public/voice, voiced with ElevenLabs): kept for the big
 * moments only, so they stay an event. They obey the same sound switch as the
 * effects and their own Voices level, only one plays at a time, and each is
 * heard once (see `speakOnce`).
 *
 * Each is played through a room (see voice-fx.ts): the bosses in a vast
 * stone hall, the narrator in a great one, a whisper close by.
 *
 * Client only. A browser lets no sound play until the visitor has touched the
 * page, so a line asked for before that waits for their first click or key.
 */

export type VoiceLine =
  | "boss-veyrath"
  | "boss-grieveth"
  | "boss-nyrrek"
  | "boss-cardinal"
  | "boss-saint"
  | "boss-slain"
  | "boss-escaped"
  | "trial-won"
  | "trial-failed"
  | "perfect-day"
  | "streak-3"
  | "streak-7"
  | "streak-14"
  | "streak-30"
  | "legendary"
  | "duel-won"
  | "duel-lost"
  | "caught";


/** Where each line is heard. */
function roomFor(line: VoiceLine): Room {
  if (line === "caught") return "close";
  if (line === "boss-escaped" || !line.startsWith("boss-")) return "hall";
  return "vast";
}

let current: HTMLAudioElement | null = null;
let waiting: (() => void) | null = null;
/** The line asked for while another was still speaking: it follows when that ends. */
let next: (() => void) | null = null;
let watching = false;

function stop() {
  next = null;
  current?.pause();
  current = null;
  if (waiting) {
    window.removeEventListener("pointerdown", waiting);
    window.removeEventListener("keydown", waiting);
    waiting = null;
  }
}

/**
 * Play a line now (or at the first touch, if the browser is holding sound
 * back). If another is still speaking it is not cut off: this one follows it.
 */
export function speak(line: VoiceLine, onStart?: () => void): void {
  if (typeof window === "undefined" || !sfxOn() || level("voice") === 0) return;
  if (!watching) {
    watching = true;
    // the Voices slider, moved mid-line
    watchLevels(() => {
      setRoomsLevel(level("voice"));
      if (current && current.volume !== 1) current.volume = level("voice");
    });
    // switching sound off silences a line mid-sentence
    watchSfx(() => {
      if (!sfxOn()) {
        stop();
        silenceRooms();
      }
    });
  }
  if (current && !waiting && !current.paused && !current.ended) {
    next = () => speak(line, onStart);
    return;
  }
  stop();
  const audio = new Audio(`/voice/${line}.mp3`);
  current = audio;
  setRoomsLevel(level("voice"));
  const fx = throughRoom(audio, roomFor(line));
  // through a room the level is a gain in the chain; played dry, the element's own
  audio.volume = fx ? 1 : level("voice");
  audio.addEventListener("ended", () => {
    fx?.release();
    if (current !== audio) return;
    current = null;
    const then = next;
    next = null;
    then?.();
  });

  const holdForTouch = () => {
    if (current !== audio) return;
    waiting = () => {
      stop();
      if (!sfxOn()) return;
      current = audio;
      void fx?.ctx.resume();
      void audio.play().then(() => onStart?.(), () => {});
    };
    window.addEventListener("pointerdown", waiting, { once: true });
    window.addEventListener("keydown", waiting, { once: true });
  };

  const start = async () => {
    // the room must be awake, or the line would play on in silence
    if (fx && fx.ctx.state !== "running") {
      await Promise.race([fx.ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
      // (read again: the wait above may have woken it)
      if ((fx.ctx.state as AudioContextState) !== "running") return holdForTouch();
    }
    try {
      await audio.play();
      onStart?.();
    } catch (err) {
      // NotAllowedError: no touch yet. Anything else (a missing file): give up quietly.
      if ((err as { name?: string })?.name === "NotAllowedError") holdForTouch();
    }
  };
  void start();
}

/**
 * Play a line unless this browser has already heard it under this key. It
 * counts as heard only once it has actually started, so a line held back by
 * the browser, or cut off by the page closing first, is tried again later.
 */
export function speakOnce(line: VoiceLine, key: string, store: "local" | "session" = "local"): void {
  const id = `voice:${key}`;
  let box: Storage | null = null;
  try {
    box = store === "local" ? localStorage : sessionStorage;
    if (box.getItem(id)) return;
  } catch {
    /* storage blocked: it may simply be heard again */
  }
  speak(line, () => {
    try {
      box?.setItem(id, "1");
    } catch {
      /* nowhere to remember it */
    }
  });
}

/** Today on this device, for keys that should be heard once a day. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * A trial's end: the narrator's blessing when it is won, his consolation when
 * it is lost for good (a failed try with tries left says nothing). Each is
 * heard at most once per trial per day.
 */
export function speakTrial(trial: string, won: boolean): void {
  speakOnce(won ? "trial-won" : "trial-failed", `${won ? "won" : "lost"}:${trial}:${today()}`);
}

/** Once per day on this device: every trial bested. */
export function speakPerfectDay(): void {
  speakOnce("perfect-day", `perfect:${today()}`);
}

/** The streak achievements that have a line of their own. */
const STREAK_LINES: Record<string, VoiceLine> = {
  ember: "streak-3",
  "tended-flame": "streak-7",
  "fortnight-vigil": "streak-14",
  "undying-flame": "streak-30",
};

/** The line for an achievement as it is announced, if it has one. */
export function achievementLine(key: string): VoiceLine | null {
  return STREAK_LINES[key] ?? null;
}

/** Leaving the page: whatever is still speaking or waiting stops. */
export function hush(): void {
  if (typeof window !== "undefined") stop();
}

/** The intro line for a boss, found by its name; null for one without a voice. */
export function bossIntro(name: string): VoiceLine | null {
  const n = name.toLowerCase();
  if (n.includes("veyrath")) return "boss-veyrath";
  if (n.includes("grieveth")) return "boss-grieveth";
  if (n.includes("nyrrek")) return "boss-nyrrek";
  if (n.includes("cardinal")) return "boss-cardinal";
  if (n.includes("saint")) return "boss-saint";
  return null;
}
