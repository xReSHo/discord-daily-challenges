"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Award, Flame, ShieldAlert, Store, Swords, Trophy, type LucideIcon } from "lucide-react";
import styles from "./AppFrame.module.css";

const LINKS: { href: string; label: string; icon: LucideIcon; admin?: boolean }[] = [
  { href: "/dashboard", label: "Trials", icon: Flame },
  { href: "/duel", label: "Pit", icon: Swords },
  { href: "/shop", label: "Shop", icon: Store },
  { href: "/leaderboard", label: "Ranks", icon: Trophy },
  { href: "/achievements", label: "Feats", icon: Award },
  { href: "/admin", label: "Admin", icon: ShieldAlert, admin: true },
];

/**
 * The site's main links. In the header on a wide screen; on a narrow one the
 * same list drops to a strip of its own below the header, where every link
 * keeps its label and a full-size target for a thumb.
 */
export function SiteNav({ admin }: { admin: boolean }) {
  const path = usePathname();
  // A page is fetched ahead of time only when the pointer (or a finger, or the
  // keyboard) reaches its link — not for every link on every page view, which
  // would spend server runs on pages nobody opens. By the click it is ready.
  const [warm, setWarm] = useState<string | null>(null);
  return (
    <nav className={styles.nav} aria-label="Main">
      {LINKS.filter((l) => !l.admin || admin).map(({ href, label, icon: Icon, admin: gated }) => {
        const on = path === href || path.startsWith(href + "/");
        const intent = on || gated ? undefined : () => setWarm(href);
        return (
          <Link
            key={href}
            href={href}
            className={`${styles.navLink} ${on ? styles.navOn : ""}`}
            aria-current={on ? "page" : undefined}
            prefetch={warm === href && !on}
            onMouseEnter={intent}
            onFocus={intent}
            onTouchStart={intent}
          >
            <Icon size={15} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
