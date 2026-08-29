/** Per-letter feedback for a guess. */
export type Mark = "correct" | "present" | "absent";

/**
 * Standard Wordle scoring with correct duplicate-letter handling:
 *   pass 1 - mark exact-position hits ("correct") and consume those letters
 *   pass 2 - mark remaining letters "present" only while unconsumed copies
 *            of that letter are left in the answer, else "absent"
 *
 * Both inputs must be 5 lowercase letters.
 */
export function evaluateGuess(guess: string, answer: string): Mark[] {
  const marks: Mark[] = ["absent", "absent", "absent", "absent", "absent"];
  const remaining: Record<string, number> = {};

  for (const ch of answer) remaining[ch] = (remaining[ch] ?? 0) + 1;

  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) {
      marks[i] = "correct";
      remaining[guess[i]]--;
    }
  }

  for (let i = 0; i < 5; i++) {
    if (marks[i] === "correct") continue;
    if ((remaining[guess[i]] ?? 0) > 0) {
      marks[i] = "present";
      remaining[guess[i]]--;
    }
  }

  return marks;
}
