"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import styles from "../boss.module.css";

export type TypingDone = {
  typed: string;
  durationMs: number;
  keystrokes: number;
};

export function MiniTyping({
  text,
  onDone,
  onCancel,
}: {
  text: string;
  onDone: (p: TypingDone) => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const startRef = useRef(0);
  const keysRef = useRef(0);
  const doneRef = useRef(false);

  const finish = useCallback(
    (value: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDone({
        typed: value,
        durationMs: startRef.current ? performance.now() - startRef.current : 0,
        keystrokes: keysRef.current,
      });
    },
    [onDone],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (doneRef.current) return;
      const v = e.target.value;
      if (!startRef.current && v.length > 0) startRef.current = performance.now();
      setTyped(v);
      if (v.length >= text.length) finish(v);
    },
    [text.length, finish],
  );

  const chars = useMemo(() => {
    return text.split("").map((ch, i) => {
      let cls = styles.tChar;
      if (i < typed.length) {
        cls += " " + (typed[i] === ch ? styles.tOk : styles.tBad);
      } else if (i === typed.length) {
        cls += " " + styles.tCaret;
      }
      return (
        <span key={i} className={cls}>
          {ch}
        </span>
      );
    });
  }, [text, typed]);

  return (
    <div className={styles.miniPlay}>
      <p className={styles.miniPrompt}>Transcribe the passing verse.</p>
      <div className={styles.tPhrase}>{chars}</div>
      <textarea
        className={styles.tInput}
        value={typed}
        onChange={onChange}
        onKeyDown={(e) => {
          if (e.key.length === 1 || e.key === "Backspace") keysRef.current += 1;
        }}
        onPaste={(e) => e.preventDefault()}
        autoFocus
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        rows={2}
        aria-label="Transcribe the verse"
      />
      <button type="button" className={styles.miniQuit} onClick={onCancel}>
        Step back
      </button>
    </div>
  );
}
