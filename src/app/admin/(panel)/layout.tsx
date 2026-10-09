import { requireAdminFrame } from "@/lib/admin-auth";
import { AppFrame } from "@/components/AppFrame";
import { getChallengeDateString } from "@/lib/challenge-date";
import { AdminNav } from "@/app/admin/AdminNav";
import styles from "@/app/admin/admin.module.css";

/**
 * Frame shared by every unlocked admin page: site header and the section tabs. A layout is rendered once and kept while you move between its
 * pages, so switching sections re-renders only the section itself — not the
 * header, the balance lookup or the tabs.
 *
 * Because it is *not* re-run on those moves, it is never the security gate:
 * every page and every action calls the gate itself. The check here only
 * decides whether to draw the frame on first load, and costs no database
 * round trip.
 */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const { expiresAt, trusted } = await requireAdminFrame();

  return (
    <AppFrame raidAlert={false}>
      <div className="container">
        <AdminNav expiresAt={expiresAt} trusted={trusted} />

        {children}

        <p className={styles.footNote}>
          All times are Bahrain time · today is <span className="mono">{getChallengeDateString()}</span>
        </p>
      </div>
    </AppFrame>
  );
}
