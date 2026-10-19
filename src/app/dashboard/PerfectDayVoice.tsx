"use client";

import { useEffect } from "react";
import { speakPerfectDay } from "@/lib/voice";

/** Rendered only on a day with every trial bested: the narrator says so, once. */
export function PerfectDayVoice() {
  useEffect(() => speakPerfectDay(), []);
  return null;
}
