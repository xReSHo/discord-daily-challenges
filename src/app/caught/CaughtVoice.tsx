"use client";

import { useEffect } from "react";
import { hush, speakOnce } from "@/lib/voice";

/** The narrator's aside, once per visit: they'll hear it again if they come back. */
export function CaughtVoice() {
  useEffect(() => {
    speakOnce("caught", "caught", "session");
    return hush;
  }, []);
  return null;
}
