import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { Orbit } from "lucide-react";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getCompletedSectionsToday } from "@/lib/completions";
import { getAttempt } from "@/lib/attempts";
import { getSectionReward, getSectionStatus } from "@/lib/section-status";
import { AppFrame } from "@/components/AppFrame";
import { GameHeader } from "@/components/GameHeader";
import { SectionClosed } from "@/components/SectionClosed";
import { LitanyGame } from "./LitanyGame";

export const dynamic = "force-dynamic";

export default async function LitanyPage() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) redirect("/");

  const [completed, attempt, status, reward] = await Promise.all([
    getCompletedSectionsToday(discordId),
    getAttempt(discordId, "litany"),
    getSectionStatus("litany"),
    getSectionReward("litany"),
  ]);
  if (status.hidden) notFound();

  return (
    <AppFrame>
      <GameHeader
        icon={Orbit}
        title="The Litany"
        reward={reward}
        date={getChallengeDateString()}
      />
      <div className="container game-page">
        <div className="game-stage">
          {status.disabled ? (
            <SectionClosed title="The Litany" note={status.note} />
          ) : (
            <LitanyGame
              completedToday={completed.has("litany")}
              failedToday={attempt.failed}
            />
          )}
        </div>
      </div>
    </AppFrame>
  );
}
