"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A block that marks itself `data-seen` the first time it scrolls into view, so
 * its styles can play something once (a bar growing, a ring filling) when the
 * reader actually reaches it instead of off screen.
 */
export function InView({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setSeen(true);
        io.disconnect();
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} data-seen={seen ? "" : undefined}>
      {children}
    </div>
  );
}
