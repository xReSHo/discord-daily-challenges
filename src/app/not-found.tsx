import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page-main">
      <div className="container" style={{ textAlign: "center", maxWidth: "40ch" }}>
        <p className="eyebrow">404</p>
        <h1 style={{ marginTop: 12, fontSize: "clamp(1.6rem, 5vw, 2.4rem)" }}>
          No such path
        </h1>
        <p className="lede" style={{ marginTop: 16 }}>
          There is nothing here. The trials are back at the gate.
        </p>
        <Link href="/dashboard" className="btn btn--gold" style={{ marginTop: 28 }}>
          Return to the trials
        </Link>
      </div>
    </main>
  );
}
