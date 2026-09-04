import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Triangle } from "lucide-react";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getGeoState } from "@/lib/geodash/game";
import { SECTIONS } from "@/lib/sections";
import { getSectionStatus } from "@/lib/section-status";
import { AppFrame } from "@/components/AppFrame";
import { GameHeader } from "@/components/GameHeader";
import { SectionClosed } from "@/components/SectionClosed";
import { GeoDash } from "./GeoDash";

export const dynamic = "force-dynamic";

export default async function GeoDashPage() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) redirect("/");

  const [state, status] = await Promise.all([
    getGeoState(discordId),
    getSectionStatus("geodash"),
  ]);

  return (
    <AppFrame back={{ href: "/dashboard", label: "All trials" }}>
      <div className="container game-page">
        <GameHeader
          icon={Triangle}
          title="Geometry Dash"
          reward={SECTIONS.geodash.reward}
          date={getChallengeDateString()}
        />
        <div className="game-stage">
          {status.disabled ? (
            <SectionClosed title="Geometry Dash" note={status.note} />
          ) : (
            <GeoDash state={state} />
          )}
        </div>
      </div>
    </AppFrame>
  );
}
