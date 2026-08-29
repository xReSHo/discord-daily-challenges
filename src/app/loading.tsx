export default function Loading() {
  return (
    <main className="page-main">
      <div
        className="container"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "40vh",
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 12,
            letterSpacing: "0.24em",
            textTransform: "uppercase",
            color: "var(--ink-mute)",
            animation: "flicker 1.6s ease-in-out infinite",
          }}
        >
          Lighting the grace…
        </span>
      </div>
    </main>
  );
}
