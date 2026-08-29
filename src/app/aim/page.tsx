import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Crosshair } from "lucide-react";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getCompletedSectionsToday } from "@/lib/completions";
import { SECTIONS } from "@/lib/sections";
import { AppFrame } from "@/components/AppFrame";
import { GameHeader } from "@/components/GameHeader";
import { AimTrainer } from "./AimTrainer";

export default async function AimPage() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) redirect("/");

  const completed = await getCompletedSectionsToday(discordId);

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
          <AimTrainer completedToday={completed.has("aim")} />
        </div>
      </div>
    </AppFrame>
  );
}
