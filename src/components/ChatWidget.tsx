"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageCircle,
  ChevronDown,
  SendHorizontal,
  Bug,
  Lightbulb,
  ArrowLeft,
} from "lucide-react";
import styles from "./ChatWidget.module.css";

type Role = "user" | "assistant" | "system";
type Msg = { role: Role; content: string };
type Mode = "chat" | "support";
type FbKind = "bug" | "idea";
type FbPhase = "idle" | "sending" | "sent" | "error";

const GREETING: Msg = {
  role: "assistant",
  content:
    "هلا وغلا 👋 أنا مساعد موقع التحديات. أقدر أساعدك بنظريات ون بيس اللي عندنا، أو بأي شي عن الموقع وألعابه والنقاط والمتجر وبوس الأسبوع. اسأل!",
};

const RATE_LIMIT_NOTE = "Too many questions at once — wait a moment, then ask again.";

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false); // panel stays in the DOM through its close animation

  // chat — deliberately NOT persisted: a page refresh starts a fresh conversation.
  const [mode, setMode] = useState<Mode>("chat");
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  // support fallback form
  const [fbKind, setFbKind] = useState<FbKind>("bug");
  const [fbText, setFbText] = useState("");
  const [fbPhase, setFbPhase] = useState<FbPhase>("idle");
  const [fbError, setFbError] = useState("");

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fbRef = useRef<HTMLTextAreaElement>(null);
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openPanel = useCallback(() => {
    if (unmountTimer.current) clearTimeout(unmountTimer.current);
    setMounted(true);
    setOpen(true);
  }, []);
  const closePanel = useCallback(() => {
    setOpen(false);
    if (unmountTimer.current) clearTimeout(unmountTimer.current);
    unmountTimer.current = setTimeout(() => setMounted(false), 280);
  }, []);
  const toggle = useCallback(
    () => (open ? closePanel() : openPanel()),
    [open, openPanel, closePanel],
  );

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      (mode === "support" ? fbRef : inputRef).current?.focus();
    }, 120);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closePanel();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, closePanel, mode]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  /** Drop into the old-style support form when the assistant can't answer. */
  const fallToSupport = useCallback(() => {
    setMessages((m) => {
      const copy = [...m];
      // strip a dangling empty assistant bubble from the failed turn
      if (copy[copy.length - 1]?.role === "assistant" && !copy[copy.length - 1].content) {
        copy.pop();
      }
      return copy;
    });
    setFbPhase("idle");
    setFbError("");
    setMode("support");
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;

    const outgoing: Msg[] = [
      ...messages.filter((m) => m.role !== "system"),
      { role: "user", content: text },
    ];
    setMessages([...outgoing, { role: "assistant", content: "" }]);
    setDraft("");
    setSending(true);

    let got = 0;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: outgoing.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (res.status === 429) {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "system", content: RATE_LIMIT_NOTE };
          return copy;
        });
        return;
      }

      const isStream = res.headers.get("content-type")?.includes("text/event-stream");
      if (!res.ok || !isStream || !res.body) return fallToSupport();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let evt: { delta?: string; done?: boolean; error?: string };
          try {
            evt = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (evt.error) return fallToSupport();
          if (evt.delta) {
            got += evt.delta.length;
            const chunk = evt.delta;
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") {
                copy[copy.length - 1] = { ...last, content: last.content + chunk };
              }
              return copy;
            });
          }
        }
      }
      if (got === 0) return fallToSupport();
    } catch {
      return fallToSupport();
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [draft, sending, messages, fallToSupport]);

  const submitFeedback = useCallback(async () => {
    const message = fbText.trim();
    if (message.length < 3) {
      setFbError("Add a little more detail.");
      return;
    }
    setFbPhase("sending");
    setFbError("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: fbKind,
          message,
          path: typeof window !== "undefined" ? window.location.pathname : "/",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setFbPhase("error");
        setFbError(data.error || "Couldn't send that. Try again.");
        return;
      }
      setFbPhase("sent");
      setFbText("");
    } catch {
      setFbPhase("error");
      setFbError("Network error. Try again.");
    }
  }, [fbText, fbKind]);

  function onInputKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const streamingLast =
    sending &&
    messages[messages.length - 1]?.role === "assistant" &&
    messages[messages.length - 1]?.content === "";

  return (
    <div className={styles.root}>
      {mounted && (
        <div
          className={`${styles.panel} ${open ? styles.panelOpen : styles.panelClosing}`}
          role="dialog"
          aria-label={mode === "support" ? "Support" : "Assistant chat"}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget && !open) setMounted(false);
          }}
        >
          <div className={styles.head}>
            <span className={styles.title}>
              {mode === "support" ? (
                <>
                  <Bug size={13} /> Support
                </>
              ) : (
                <>
                  <span className={styles.titleDot} aria-hidden />
                  Assistant
                </>
              )}
            </span>
            <button
              type="button"
              className={styles.close}
              onClick={closePanel}
              aria-label="Close"
            >
              <ChevronDown size={16} />
            </button>
          </div>

          {mode === "support" ? (
            <div className={styles.support}>
              {fbPhase === "sent" ? (
                <div className={styles.fbDone}>
                  <p>Sent — thank you. We read every one.</p>
                  <button
                    type="button"
                    className={styles.backLink}
                    onClick={() => setMode("chat")}
                  >
                    <ArrowLeft size={13} /> Back to the assistant
                  </button>
                </div>
              ) : (
                <>
                  <p className={styles.supportNote}>
                    The assistant is having trouble right now. If you hit a bug or
                    have a suggestion, leave it here — it goes straight to the
                    keeper.
                  </p>

                  <div className={styles.kinds}>
                    <button
                      type="button"
                      className={fbKind === "bug" ? styles.kindOn : styles.kind}
                      onClick={() => setFbKind("bug")}
                    >
                      <Bug size={14} /> Bug
                    </button>
                    <button
                      type="button"
                      className={fbKind === "idea" ? styles.kindOn : styles.kind}
                      onClick={() => setFbKind("idea")}
                    >
                      <Lightbulb size={14} /> Suggestion
                    </button>
                  </div>

                  <textarea
                    ref={fbRef}
                    className={styles.fbText}
                    value={fbText}
                    onChange={(e) => setFbText(e.target.value)}
                    maxLength={2000}
                    rows={4}
                    placeholder={
                      fbKind === "bug"
                        ? "What happened, and what did you expect?"
                        : "What would make this better?"
                    }
                  />

                  {fbError && <p className={styles.fbError}>{fbError}</p>}

                  <button
                    type="button"
                    className={styles.fbSend}
                    onClick={() => void submitFeedback()}
                    disabled={fbPhase === "sending"}
                  >
                    {fbPhase === "sending" ? "Sending…" : "Send"}
                  </button>

                  <button
                    type="button"
                    className={styles.backLink}
                    onClick={() => setMode("chat")}
                  >
                    <ArrowLeft size={13} /> Try the assistant again
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <div className={styles.list} ref={listRef}>
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={
                      m.role === "user"
                        ? styles.rowUser
                        : m.role === "system"
                          ? styles.rowSystem
                          : styles.rowBot
                    }
                  >
                    <p className={styles.bubble} dir="auto">
                      {m.content}
                      {streamingLast && i === messages.length - 1 && (
                        <span className={styles.dots} aria-label="Thinking">
                          <span />
                          <span />
                          <span />
                        </span>
                      )}
                    </p>
                  </div>
                ))}
              </div>

              <div className={styles.composer}>
                <textarea
                  ref={inputRef}
                  className={styles.input}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onInputKey}
                  rows={1}
                  maxLength={1500}
                  placeholder="Ask about One Piece or the challenges…"
                  disabled={sending}
                />
                <button
                  type="button"
                  className={styles.sendBtn}
                  onClick={() => void send()}
                  disabled={sending || draft.trim().length === 0}
                  aria-label="Send"
                >
                  <SendHorizontal size={16} />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        className={`${styles.fab} ${open ? styles.fabOpen : ""}`}
        onClick={toggle}
        aria-label={open ? "Close assistant" : "Open assistant"}
        aria-expanded={open}
      >
        <span className={styles.fabIcon}>
          <MessageCircle size={22} className={styles.iconChat} />
          <ChevronDown size={22} className={styles.iconClose} />
        </span>
      </button>
    </div>
  );
}
