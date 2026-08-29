/**
 * Fixed, non-interactive background layer: fog gradients, film grain, and a
 * drift of embers. Deterministic ember placement (index-based) so server and
 * client markup match. Motion is disabled under prefers-reduced-motion via CSS.
 */

const EMBERS = Array.from({ length: 20 }, (_, i) => {
  const left = (i * 61 + 7) % 100;
  const delay = (i * 137) % 220 / 10; // 0–22s
  const duration = 16 + ((i * 7) % 12); // 16–28s
  const drift = ((i % 5) - 2) * 14; // px
  const size = i % 6 === 0 ? 3 : 2;
  return { left, delay, duration, drift, size };
});

export function Atmosphere() {
  return (
    <div className="atmosphere" aria-hidden="true">
      <div className="atmosphere__fog" />
      <div className="atmosphere__vignette" />
      <div className="atmosphere__grain" />
      <div className="atmosphere__embers">
        {EMBERS.map((e, i) => (
          <span
            key={i}
            className="ember"
            style={{
              left: `${e.left}%`,
              width: e.size,
              height: e.size,
              animationDelay: `${e.delay}s`,
              animationDuration: `${e.duration}s`,
              // @ts-expect-error custom property
              "--drift": `${e.drift}px`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
