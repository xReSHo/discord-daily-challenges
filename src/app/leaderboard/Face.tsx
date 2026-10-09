"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A player's portrait. Discord avatar addresses go stale when someone changes
 * their picture, and a dead one would show the browser's broken-image mark.
 * When that happens the site asks Discord for the current picture and shows
 * that; the player's initial stands in meanwhile, and for good if they have
 * no picture at all.
 */

/** One repair per dead address, however many times that face is on the page. */
const repairs = new Map<string, Promise<string | null>>();

function repair(image: string): Promise<string | null> {
  let job = repairs.get(image);
  if (!job) {
    job = fetch("/api/avatar/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    })
      .then((res) => (res.ok ? res.json() : { image: null }))
      .then((data: { image?: string | null }) => data.image ?? null)
      .catch(() => null);
    repairs.set(image, job);
  }
  return job;
}

export function Face({ image, name, className }: { image: string | null; name: string; className: string }) {
  const [dead, setDead] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const ref = useRef<HTMLImageElement>(null);
  const src = fresh ?? image;

  /** The picture failed: fall back to the initial, and try once to repair it. */
  function died() {
    setDead(true);
    if (!image || fresh) return;
    void repair(image).then((next) => {
      if (!next) return;
      setFresh(next);
      setDead(false);
    });
  }
  const onDead = useRef(died);
  useEffect(() => {
    onDead.current = died;
  });

  // The picture can fail before this component is listening for it (the page
  // arrives as HTML first), so check once on waking as well.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) onDead.current();
  }, []);

  if (!src || dead) {
    return (
      <span className={className} data-initial="" aria-hidden="true">
        {[...name.trim()][0]?.toUpperCase() ?? "?"}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={ref} src={src} alt="" className={className} onError={died} />
  );
}
