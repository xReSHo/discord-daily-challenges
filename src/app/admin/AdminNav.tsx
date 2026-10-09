"use client";

import { useEffect, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Award,
  Gamepad2,
  KeyRound,
  Lock,
  ScrollText,
  Shield,
  Store,
  Sword,
  Swords,
  type LucideIcon,
} from "lucide-react";
import { lockAction } from "./actions";
import styles from "./admin.module.css";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/admin", label: "Overview", icon: ScrollText },
  { href: "/admin/games", label: "Games", icon: Gamepad2 },
  { href: "/admin/boss", label: "Boss", icon: Swords },
  { href: "/admin/pit", label: "Pit", icon: Sword },
  { href: "/admin/equipment", label: "Equipment", icon: Shield },
  { href: "/admin/shop", label: "Shop", icon: Store },
  { href: "/admin/achievements", label: "Achievements", icon: Award },
  { href: "/admin/security", label: "Security", icon: KeyRound },
];

/** Marks the link you just clicked while its page is on the way. */
function Pending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`${styles.navPending} ${pending ? styles.navPendingOn : ""}`} />;
}

/** How long the unlock still has, counted down in the browser. When it runs
 *  out the page is refreshed, which sends you to the unlock screen. */
function SessionTimer({ expiresAt, trusted }: { expiresAt: number; trusted: boolean }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(tick);
  }, []);

  const left = expiresAt - now;
  useEffect(() => {
    if (left <= 0) router.refresh();
  }, [left, router]);

  const mins = Math.max(0, Math.ceil(left / 60_000));
  const span =
    mins >= 2 * 1440
      ? `${Math.floor(mins / 1440)} days`
      : mins >= 120
        ? `${Math.floor(mins / 60)} hours`
        : `${mins} min`;
  return (
    <span className={mins <= 5 ? styles.warn : undefined} suppressHydrationWarning>
      {trusted ? "Trusted browser" : "Unlocked"} · {span} left
    </span>
  );
}

/**
 * One section tab. The section is fetched when the pointer (or keyboard focus)
 * reaches the tab, so it is usually ready by the time the click lands — but a
 * section nobody heads for is never fetched. Prefetching all six on every page
 * view would cost six server runs and six database queries each time.
 */
function NavTab({
  href,
  on,
  children,
}: {
  href: string;
  on: boolean;
  children: React.ReactNode;
}) {
  const [warm, setWarm] = useState(false);
  return (
    <Link
      href={href}
      prefetch={warm && !on}
      onMouseEnter={() => setWarm(true)}
      onFocus={() => setWarm(true)}
      onTouchStart={() => setWarm(true)}
      className={`${styles.navLink} ${on ? styles.navOn : ""}`}
      aria-current={on ? "page" : undefined}
    >
      {children}
    </Link>
  );
}

/**
 * The admin section tabs. Lives in the panel layout, so it stays mounted while
 * the page underneath changes: the active tab switches the instant you click.
 */
export function AdminNav({ expiresAt, trusted }: { expiresAt: number; trusted: boolean }) {
  const pathname = usePathname();

  return (
    <nav className={styles.nav} aria-label="Admin sections">
      {NAV.map((n) => {
        const on = n.href === "/admin" ? pathname === "/admin" : pathname.startsWith(n.href);
        return (
          <NavTab key={n.href} href={n.href} on={on}>
            <n.icon size={14} />
            {n.label}
            <Pending />
          </NavTab>
        );
      })}
      <span className={styles.navSession}>
        <SessionTimer expiresAt={expiresAt} trusted={trusted} />
        <form action={lockAction}>
          <button type="submit" className={styles.gameBtn}>
            <Lock size={11} /> Lock
          </button>
        </form>
      </span>
    </nav>
  );
}
