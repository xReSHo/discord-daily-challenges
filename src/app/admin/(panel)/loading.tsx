import { Skeleton } from "@/app/admin/ui";
import styles from "@/app/admin/admin.module.css";

/** Shown inside the admin frame the instant a section tab is clicked, until
 *  that section's data arrives. The header and tabs stay put. */
export default function AdminSectionLoading() {
  return (
    <div role="status" aria-label="Loading section">
      <span className={`${styles.skeletonRow} ${styles.skeletonTitle}`} aria-hidden />
      <Skeleton rows={4} />
    </div>
  );
}
