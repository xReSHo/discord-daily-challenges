import Link from "next/link";
import { ArrowLeft, LogOut, ShieldAlert } from "lucide-react";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { doSignOut } from "@/app/actions";
import { Sigil } from "./Sigil";
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

  return (
    <>
      <header className={styles.header}>
        <div className={`container ${styles.headerInner}`}>
          <Link href="/dashboard" className={styles.brand}>
            <Sigil size={26} className={styles.brandMark} />
            <span className="display">Daily Challenges</span>
          </Link>

          <div className={styles.headerRight}>
            {showAdmin && (
              <Link href="/admin" className={styles.adminLink} title="Admin">
                <ShieldAlert size={15} />
                <span className={styles.logoutLabel}>Admin</span>
              </Link>
            )}
            {user?.name && (
              <span className={styles.who}>
                {user.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.image} alt="" className={styles.avatar} />
                )}
                <span className={styles.whoName}>{user.name}</span>
              </span>
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
    </>
  );
}
