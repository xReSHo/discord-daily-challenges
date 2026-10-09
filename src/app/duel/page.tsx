import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { AppFrame } from "@/components/AppFrame";
import { PageHero } from "@/components/PageHero";
import { getPit, pitTerms } from "@/lib/duel/game";
import { getPitSettings } from "@/lib/site-settings";
import { SectionClosed } from "@/components/SectionClosed";
import { isDevMode } from "@/lib/dev-mode";
import { Pit } from "./Pit";
import styles from "./duel.module.css";

export const dynamic = "force-dynamic";

export default async function DuelPage() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) redirect("/");

  const [pit, practice, settings] = await Promise.all([
    getPit(discordId),
    isDevMode(discordId),
    getPitSettings(),
  ]);

  return (
    <AppFrame flow="/duel">
      <PageHero
        compact
        art="pit"
        eyebrow="The Pit"
        title="Stake and steel"
        back={{ href: "/dashboard", label: "All trials" }}
      >
        <p className={styles.sub}>
          Choose five moves in secret, stake your coin, and let them be played against another&apos;s. First to
          three rounds takes the pot.
        </p>
      </PageHero>

      <div className="container">
        {settings.open ? (
          <Pit pit={pit} practice={practice} terms={pitTerms(settings)} />
        ) : (
          <SectionClosed
            title="The Pit"
            note={settings.note ?? "The pit is closed for now. Any challenge you had waiting has been withdrawn and its stake returned."}
          />
        )}
      </div>
    </AppFrame>
  );
}
