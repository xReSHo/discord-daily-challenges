import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { Crosshair } from "lucide-react";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getCompletedSectionsToday } from "@/lib/completions";
import { getAttempt } from "@/lib/attempts";
import { getSectionReward, getSectionStatus } from "@/lib/section-status";
import { aimMaxTries } from "@/lib/aim/game";
import { MAX_MISSES, TARGET_COUNT, TTL_MS } from "@/lib/aim/daily";
import { AppFrame } from "@/components/AppFrame";
import { GameHeader } from "@/components/GameHeader";
import { SectionClosed } from "@/components/SectionClosed";
import { AimTrainer } from "./AimTrainer";

export const dynamic = "force-dynamic";

export default async function AimPage() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) redirect("/");

  const [completed, attempt, status, reward, maxTries] = await Promise.all([
    getCompletedSectionsToday(discordId),
    getAttempt(discordId, "aim"),
    getSectionStatus("aim"),
    getSectionReward("aim"),
    aimMaxTries(),
  ]);
  if (status.hidden) notFound();

  return (
    <AppFrame>
      <GameHeader
        icon={Crosshair}
        title="Aim Trainer"
        reward={reward}
        date={getChallengeDateString()}
        art="aim"
      />
      <div className="container game-page">
        <div className="game-stage">
          {status.disabled ? (
            <SectionClosed title="Aim Trainer" note={status.note} />
          ) : (
            <AimTrainer
              completedToday={completed.has("aim")}
              failedToday={attempt.failed}
              triesUsed={attempt.fails}
              maxTries={maxTries}
              brief={{ count: TARGET_COUNT, ttlMs: TTL_MS, maxMisses: MAX_MISSES }}
            />
          )}
        </div>
      </div>
    </AppFrame>
  );
}
