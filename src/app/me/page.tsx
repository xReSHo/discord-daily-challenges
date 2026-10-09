import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getStreakLeaderboard } from "@/lib/leaderboard";
import { AppFrame } from "@/components/AppFrame";
import { PageHero } from "@/components/PageHero";
import { YourRecord } from "@/components/YourRecord";
import { Pack } from "@/components/Pack";
import { Equipment, EquipmentView } from "@/components/Equipment";
import { isAdmin } from "@/lib/admin";
import styles from "@/components/YourRecord.module.css";

export const dynamic = "force-dynamic";

/** Where the player stands on the streak board, as a way back to it. */
async function Standing({ discordId }: { discordId: string }) {
  const you = (await getStreakLeaderboard(discordId)).find((r) => r.you);
  return (
    <Link href="/leaderboard" className={`${styles.standing} rise`}>
      <span className={styles.standingNum}>{you ? `#${you.rank}` : "—"}</span>
      <span className={styles.standingLabel}>
        {you ? "your standing" : "not yet ranked"}
        <small>see the board</small>
      </span>
    </Link>
  );
}

/**
 * One piece of each rarity, so an admin can see the slots filled without
 * owning anything: /me?equipment=sample
 */
const SAMPLE = new Set([
  "scholars-circlet",
  "veyraths-fang",
  "bulwark-of-the-faithful",
  "leather-bracers",
  "worn-sandals",
]);

export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<{ equipment?: string }>;
}) {
  const { equipment } = await searchParams;
  const session = await auth();
  const user = session?.user;
  const discordId = user?.discordId;
  if (!discordId) redirect("/");
  const sample = equipment === "sample" && isAdmin(discordId);

  return (
    <AppFrame flow="/me">
      <PageHero
        art="hero"
        eyebrow="Your record"
        title={user.name ?? "Nameless"}
        back={{ href: "/dashboard", label: "All trials" }}
        aside={
          <Suspense fallback={null}>
            <Standing discordId={discordId} />
          </Suspense>
        }
      >
        <p className={styles.sub}>Everything you have done here, in full. Only you can see this page.</p>
      </PageHero>

      <div className="container">
        {/* one small read of its own, like the pack below it */}
        {sample ? (
          <EquipmentView owned={SAMPLE} sample />
        ) : (
          <Suspense fallback={null}>
            <Equipment discordId={discordId} />
          </Suspense>
        )}

        {/* one small read of its own, so it shows before the record does */}
        <Suspense fallback={null}>
          <Pack discordId={discordId} />
        </Suspense>

        {/* several database trips: streamed in under the banner */}
        <Suspense fallback={<p className={styles.wait}>Reading your record…</p>}>
          <YourRecord discordId={discordId} />
        </Suspense>
      </div>
    </AppFrame>
  );
}
