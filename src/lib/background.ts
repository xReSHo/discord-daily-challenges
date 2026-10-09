/**
 * Work that should finish after the reply has gone out — an achievement
 * check, say — without the player waiting on it.
 *
 * A promise that is merely left un-awaited is not enough on a serverless
 * host: the function is frozen the moment the response is sent, and whatever
 * was still running is dropped. `after` tells the host to keep the function
 * alive until the task is done.
 */

import { after } from "next/server";

export function later(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    // not inside a request (a script, a test): just run it
    void task().catch(() => {});
  }
}
