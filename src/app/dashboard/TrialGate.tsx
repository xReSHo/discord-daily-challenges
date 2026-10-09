"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { calm, enterTrial } from "@/lib/trial-enter";

/**
 * A trial's banner on the dashboard, as a link. Clicking it plays the trial's
 * entrance (see lib/trial-enter) instead of the ordinary page change.
 *
 * Nothing is fetched until the visitor shows interest — pointer over the
 * banner, a touch, or keyboard focus — and then both the trial's page and its
 * clip are fetched ahead, so they are ready by the click.
 */
export function TrialGate({
  href,
  clip,
  className,
  children,
}: {
  href: string;
  /** address of the entrance clip, if this trial has one */
  clip?: string;
  className: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [warm, setWarm] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);

  const warmUp = () => {
    setWarm(true);
    if (!clip || video.current || calm()) return;
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = clip;
    v.load();
    video.current = v;
  };

  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (calm() || typeof e.currentTarget.animate !== "function") return;
    e.preventDefault();
    void enterTrial(router, href, e.currentTarget, video.current);
    // a clip is played once; the next entrance gets a fresh one
    video.current = null;
  };

  return (
    <Link
      href={href}
      prefetch={warm}
      // the entrance replaces the site's usual page transition
      data-no-vt=""
      className={className}
      onPointerEnter={warmUp}
      onTouchStart={warmUp}
      onFocus={warmUp}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}
