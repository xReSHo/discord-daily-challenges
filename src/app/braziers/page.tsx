import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { FlameKindling } from "lucide-react";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getCompletedSectionsToday } from "@/lib/completions";
import { getAttempt, lockNow } from "@/lib/attempts";
import { getSectionReward, getSectionStatus } from "@/lib/section-status";
import { braziersMaxTries, outOfTries } from "@/lib/braziers/game";
import { MOVE_CAP, PAR, SIZE } from "@/lib/braziers/rules";
import { AppFrame } from "@/components/AppFrame";
import { GameHeader } from "@/components/GameHeader";
import { SectionClosed } from "@/components/SectionClosed";
import { BraziersGame } from "./BraziersGame";

export const dynamic = "force-dynamic";

export default async function BraziersPage() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) redirect("/");

  const [completed, attempt, status, reward, maxTries] = await Promise.all([
    getCompletedSectionsToday(discordId),
    getAttempt(discordId, "braziers"),
    getSectionStatus("braziers"),
    getSectionReward("braziers"),
    braziersMaxTries(),
  ]);
  if (status.hidden) notFound();

  // The last run was begun and then left (a reload, a closed tab): the day is
  // lost, and the dashboard should say so too.
  const done = completed.has("braziers");
  const failed = !done && outOfTries(attempt, maxTries);
  if (failed && !attempt.failed) await lockNow(discordId, "braziers");

  return (
    <AppFrame>
      <GameHeader
        icon={FlameKindling}
        title="The Braziers"
        reward={reward}
        date={getChallengeDateString()}
        art="braziers"
      />
      <div className="container game-page">
        <div className="game-stage">
          {status.disabled ? (
            <SectionClosed title="The Braziers" note={status.note} />
          ) : (
            <BraziersGame
              completedToday={done}
              failedToday={failed}
              triesUsed={attempt.fails}
              maxTries={maxTries}
              brief={{ size: SIZE, par: PAR, cap: MOVE_CAP }}
            />
          )}
        </div>
      </div>
    </AppFrame>
  );
}
