"use client";

/**
 * Last-resort boundary: only renders if the root layout itself throws. It
 * must provide its own <html>/<body> because the normal layout never ran.
 */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0a0908",
          color: "#efe8d7",
          fontFamily: "Georgia, 'Times New Roman', serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "40ch" }}>
          <h1 style={{ fontSize: "1.8rem", fontWeight: 500 }}>
            The world went dark
          </h1>
          <p style={{ marginTop: 12, color: "#bcb19c", lineHeight: 1.6 }}>
            A fatal error stopped the site loading. Reload to try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 24,
              padding: "0.8em 1.8em",
              font: "inherit",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#1a1409",
              background: "linear-gradient(180deg, #ecca77, #c8a24c)",
              border: "1px solid #c8a24c",
              borderRadius: "2px",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
