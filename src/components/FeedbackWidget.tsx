"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Bug, Lightbulb, LifeBuoy, X } from "lucide-react";
import styles from "./FeedbackWidget.module.css";

type Kind = "bug" | "idea";
type Phase = "idle" | "sending" | "sent" | "error";

export function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("bug");
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => textRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    if (!open) {
      setPhase("idle");
      setError("");
    }
    setOpen(!open);
  }

  async function submit() {
    if (message.trim().length < 3) {
      setError("Add a little more detail.");
      return;
    }
    setPhase("sending");
    setError("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, message: message.trim(), path: pathname }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setPhase("error");
        setError(data.error || "Couldn't send that. Try again.");
        return;
      }
      setPhase("sent");
      setMessage("");
      setTimeout(() => setOpen(false), 2200);
    } catch {
      setPhase("error");
      setError("Network error. Try again.");
    }
  }

  return (
    <div className={styles.root}>
      {open && (
        <div className={styles.panel} role="dialog" aria-label="Send feedback">
          <div className={styles.head}>
            <span className={styles.title}>
              <LifeBuoy size={15} /> Support
            </span>
            <button
              type="button"
              className={styles.close}
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>

          {phase === "sent" ? (
            <p className={styles.done}>
              Sent — thank you. We read every one.
            </p>
          ) : (
            <>
              <div className={styles.kinds}>
                <button
                  type="button"
                  className={kind === "bug" ? styles.kindOn : styles.kind}
                  onClick={() => setKind("bug")}
                >
                  <Bug size={14} /> Bug
                </button>
                <button
                  type="button"
                  className={kind === "idea" ? styles.kindOn : styles.kind}
                  onClick={() => setKind("idea")}
                >
                  <Lightbulb size={14} /> Suggestion
                </button>
              </div>

              <textarea
                ref={textRef}
                className={styles.text}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={2000}
                rows={4}
                placeholder={
                  kind === "bug"
                    ? "What happened, and what did you expect?"
                    : "What would make this better?"
                }
              />

              {error && <p className={styles.error}>{error}</p>}

              <button
                type="button"
                className={styles.send}
                onClick={submit}
                disabled={phase === "sending"}
              >
                {phase === "sending" ? "Sending…" : "Send"}
              </button>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        className={styles.fab}
        onClick={toggle}
        aria-label="Send feedback"
        aria-expanded={open}
      >
        {open ? <X size={17} /> : <LifeBuoy size={17} />}
        <span className={styles.fabLabel}>Support</span>
      </button>
    </div>
  );
}
