import { notFound, redirect } from "next/navigation";
import { getAdminState, trustDays } from "@/lib/admin-auth";
import { AppFrame } from "@/components/AppFrame";
import { UnlockForm } from "@/app/admin/GateForms";
import styles from "@/app/admin/admin.module.css";

export const dynamic = "force-dynamic";

export default async function AdminUnlockPage() {
  const state = await getAdminState();
  if (state.kind === "none") notFound();
  if (state.kind === "unenrolled") redirect("/admin/setup");
  if (state.kind === "ok") redirect("/admin");

  return (
    <AppFrame back={{ href: "/dashboard", label: "Back to trials" }}>
      <div className="container">
        <section className={`${styles.gate} rise`}>
          <p className="eyebrow">Admin</p>
          <h1 className={styles.gateTitle}>Unlock admin</h1>
          <p className={styles.gateText}>
            Your admin password and the current code from your authenticator
            app. Five wrong attempts lock admin access for 15 minutes.
          </p>
          <UnlockForm trustDays={trustDays()} />
        </section>
      </div>
    </AppFrame>
  );
}
