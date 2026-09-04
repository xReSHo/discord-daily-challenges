import Link from "next/link";
import { ArrowLeft, Award, LogOut, ShieldAlert, Store, Trophy } from "lucide-react";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { isDevMode } from "@/lib/dev-mode";
import { getBalance } from "@/lib/unbelievaboat";
import { doSignOut } from "@/app/actions";
import { Sigil } from "./Sigil";
import { AchievementToaster } from "./AchievementToaster";
import { BalancePill } from "./BalancePill";
import { ChatWidget } from "./ChatWidget";
import { DevModeToggle } from "./DevModeToggle";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./AppFrame.module.css";

/** Shared shell for the authed pages: header, centered content, footer. */
export async function AppFrame({
  children,
  back,
}: {
  children: React.ReactNode;
  back?: { href: string; label: string };
}) {
  const session = await auth();
  const user = session?.user;
  const showAdmin = isAdmin(user?.discordId);
  const devOn = showAdmin && (await isDevMode(user?.discordId));
  const balance = user?.discordId ? await getBalance(user.discordId) : null;

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/dashboard" className={styles.brand}>
            <Sigil size={26} className={styles.brandMark} />
            <span className="display">Daily Challenges</span>
          </Link>

          <div className={styles.headerRight}>
            <ThemeToggle />
            {balance && (
              <BalancePill
                cash={balance.cash}
                bank={balance.bank}
                total={balance.total}
              />
            )}
            {user?.discordId && (
              <Link href="/shop" className={styles.adminLink} title="Shop">
                <Store size={15} />
                <span className={styles.logoutLabel}>Shop</span>
              </Link>
            )}
            {user?.discordId && (
              <Link
                href="/leaderboard"
                className={styles.adminLink}
                title="Streak leaderboard"
              >
                <Trophy size={15} />
                <span className={styles.logoutLabel}>Ranks</span>
              </Link>
            )}
            {user?.discordId && (
              <Link href="/achievements" className={styles.adminLink} title="Achievements">
                <Award size={15} />
                <span className={styles.logoutLabel}>Feats</span>
              </Link>
            )}
            {showAdmin && <DevModeToggle on={devOn} />}
            {showAdmin && (
              <Link href="/admin" className={styles.adminLink} title="Admin">
                <ShieldAlert size={15} />
                <span className={styles.logoutLabel}>Admin</span>
              </Link>
            )}
            {user?.name && (
              <Link href="/me" className={styles.who} title="Your record">
                {user.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.image} alt="" className={styles.avatar} />
                )}
                <span className={styles.whoName}>{user.name}</span>
              </Link>
            )}
            <form action={doSignOut}>
              <button type="submit" className="btn btn--sm btn--quiet">
                <LogOut />
                <span className={styles.logoutLabel}>Leave</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      {back && (
        <div className={`container ${styles.backRow}`}>
          <Link href={back.href} className={styles.back}>
            <ArrowLeft size={14} />
            {back.label}
          </Link>
        </div>
      )}

      <main className="page-main">{children}</main>

      <footer className={styles.footer}>
        <div className={`container ${styles.footerInner}`}>
          <span className="mono">— one grace per day —</span>
          <span className="mono">{new Date().getUTCFullYear()}</span>
        </div>
      </footer>

      {user?.discordId && <AchievementToaster />}
      {user?.discordId && <ChatWidget />}
    </>
  );
}
