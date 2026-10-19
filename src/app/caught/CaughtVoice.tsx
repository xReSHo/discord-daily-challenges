"use client";

import { useEffect } from "react";
import { holdAmbience } from "@/lib/ambience";
import { hush, speakOnce } from "@/lib/voice";

/**
 * The narrator's aside, once per visit: they'll hear it again if they come
 * back. The room's ambience is held silent here, since the page has no sound
 * control (it is shown at whatever address was asked for, so the root
 * layout can't tell it apart by path).
 */
export function CaughtVoice() {
  useEffect(() => {
    const release = holdAmbience();
    speakOnce("caught", "caught", "session");
    return () => {
      release();
      hush();
    };
  }, []);
  return null;
}
