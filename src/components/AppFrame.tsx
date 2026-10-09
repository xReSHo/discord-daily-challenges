import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft,
  ArrowRight, LogOut } from "lucide-react";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { isDevMode } from "@/lib/dev-mode";
import { getBalance } from "@/lib/unbelievaboat";
import { doSignOut } from "@/app/actions";
import { Sigil } from "./Sigil";
import { AchievementToaster } from "./AchievementToaster";
import { BalancePill } from "./BalancePill";
import { DevModeToggle } from "./DevModeToggle";
import { SoundToggle } from "./SoundToggle";
import { PageFlow } from "./PageFlow";
import { SiteNav } from "./SiteNav";
import { flowNeighbours } from "@/lib/page-flow";
import { getRaidBrief } from "@/lib/boss/game";
import styles from "./AppFrame.module.css";

async function HeaderBalance({ discordId }: { discordId: string }) {
  const balance = await getBalance(discordId);
  if (!balance) return null;
  return <BalancePill cash={balance.cash} bank={balance.bank} total={balance.total} />;
}

/** Shared shell for the authed pages: header, centered content, footer.
 *  `flow` is this page's address when it is one of the main pages: scrolling
 *  on past its bottom or top then leads into its neighbours (see PageFlow),
 *  and the foot of the page is the top of the next one instead of the footer. */
/** A raid is on: say so at the top of every page, with the way in. */
async function RaidAlert({ discordId }: { discordId: string }) {
  const raid = await getRaidBrief(discordId);
  if (!raid) return null;
  return (
    <Link href="/boss" className={styles.raid}>
      <span className={styles.raidLive}>
        <i aria-hidden="true" /> Raid live
      </span>
      <span className={styles.raidText}>
        <b>{raid.name}</b>
        <span>
          {Math.ceil(raid.hpLeft * 100)}% health · {raidTimeLeft(raid.expiresAt)} left
          {raid.adminOnly
            ? " · test raid, admins only"
            : ` · if it survives, everyone loses ${raid.penaltyEach.toLocaleString("en-US")}`}
        </span>
      </span>
      <span className={styles.raidGo}>
        Fight <ArrowRight size={13} />
      </span>
    </Link>
  );
}

function raidTimeLeft(expiresAt: string): string {
  const s = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export async function AppFrame({
  children,
  back,
  flow,
  raidAlert = true,
}: {
  children: React.ReactNode;
  back?: { href: string; label: string };
  flow?: string;
  /** false on the pages that already say a raid is on in their own way */
  raidAlert?: boolean;
}) {
  const { prev, next } = flow ? flowNeighbours(flow) : {};
  const session = await auth();
  const user = session?.user;
  const showAdmin = isAdmin(user?.discordId);
  const devOn = showAdmin && (await isDevMode(user?.discordId));

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/dashboard" className={styles.brand}>
            <Sigil size={26} className={styles.brandMark} />
            <span className={`display ${styles.brandName}`}>Daily Challenges</span>
          </Link>

          {user?.discordId && <SiteNav admin={showAdmin} />}

          <div className={styles.headerRight}>
            {user?.discordId && (
              // The balance comes from UnbelievaBoat, a separate service that
              // can take a few hundred milliseconds. It is streamed in when it
              // answers, so no page waits on it to appear.
              <Suspense fallback={<span className={styles.balanceGhost} aria-hidden="true" />}>
                <HeaderBalance discordId={user.discordId} />
              </Suspense>
            )}
            <SoundToggle />
            {showAdmin && <DevModeToggle on={devOn} />}
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
              <button type="submit" className={`btn btn--sm btn--quiet ${styles.leave}`} title="Leave">
                <LogOut />
                <span className={styles.leaveLabel}>Leave</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      {raidAlert && user?.discordId && (
        // one cached read; streamed in so no page waits on it
        <Suspense fallback={null}>
          <RaidAlert discordId={user.discordId} />
        </Suspense>
      )}

      {back && (
        <div className={`container ${styles.backRow}`}>
          <Link href={back.href} className={styles.back}>
            <ArrowLeft size={14} />
            {back.label}
          </Link>
        </div>
      )}

      <main className="page-main">{children}</main>

      {(prev || next) && <PageFlow prev={prev} next={next} />}
      {!next && (
        <footer className={styles.footer}>
          <div className={`container ${styles.footerInner}`}>
            <span className="mono">one grace per day</span>
            <span className="mono">{new Date().getUTCFullYear()}</span>
          </div>
        </footer>
      )}

      {user?.discordId && <AchievementToaster />}
    </>
  );
}
