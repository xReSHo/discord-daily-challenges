import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Crosshair } from "lucide-react";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getCompletedSectionsToday } from "@/lib/completions";
import { getAttempt } from "@/lib/attempts";
import { SECTIONS } from "@/lib/sections";
import { getSectionStatus } from "@/lib/section-status";
import { AppFrame } from "@/components/AppFrame";
import { GameHeader } from "@/components/GameHeader";
import { SectionClosed } from "@/components/SectionClosed";
import { AimTrainer } from "./AimTrainer";

export const dynamic = "force-dynamic";

export default async function AimPage() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) redirect("/");

  const [completed, attempt, status] = await Promise.all([
    getCompletedSectionsToday(discordId),
    getAttempt(discordId, "aim"),
    getSectionStatus("aim"),
  ]);

  return (
    <AppFrame back={{ href: "/dashboard", label: "All trials" }}>
      <div className="container game-page">
        <GameHeader
          icon={Crosshair}
          title="Aim Trainer"
          reward={SECTIONS.aim.reward}
          date={getChallengeDateString()}
        />
        <div className="game-stage">
          {status.disabled ? (
            <SectionClosed title="Aim Trainer" note={status.note} />
          ) : (
            <AimTrainer
              completedToday={completed.has("aim")}
              failedToday={attempt.failed}
              triesUsed={attempt.fails}
            />
          )}
        </div>
      </div>
    </AppFrame>
  );
}
