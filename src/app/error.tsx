"use client";

import { useEffect } from "react";
import { logger } from "@/lib/logger";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("route.render_error", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="page-main">
      <div className="container" style={{ textAlign: "center", maxWidth: "40ch" }}>
        <p className="eyebrow">Something broke</p>
        <h1 style={{ marginTop: 12, fontSize: "clamp(1.6rem, 5vw, 2.4rem)" }}>
          The trial faltered
        </h1>
        <p className="lede" style={{ marginTop: 16 }}>
          An unexpected error stopped this page. Your progress and rewards are
          safe — try again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="btn btn--gold"
          style={{ marginTop: 28 }}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
