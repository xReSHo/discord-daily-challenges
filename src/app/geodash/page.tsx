import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { Triangle } from "lucide-react";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getGeoState } from "@/lib/geodash/game";
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
  if (status.hidden) notFound();

  return (
    <AppFrame>
      <GameHeader
        icon={Triangle}
        title="Geometry Dash"
        reward={state.entry}
        date={getChallengeDateString()}
      />
      <div className="container game-page">
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
