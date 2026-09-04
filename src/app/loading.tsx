/** The site of grace, kindling — its light rises to fill the sigil while the
 *  route loads. The animation is a single compositor-only transform (plus one
 *  opacity fade); reduced-motion holds it fully lit. Styles: src/app/globals.css */
export default function Loading() {
  return (
    <main className="page-main">
      <div className="container grace-loader">
        <div
          className="grace-loader__grace"
          role="img"
          aria-label="Lighting the grace"
        />
        <span className="grace-loader__label mono">Lighting the grace…</span>
      </div>
    </main>
  );
}
