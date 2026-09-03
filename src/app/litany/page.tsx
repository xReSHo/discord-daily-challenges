import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Orbit } from "lucide-react";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getCompletedSectionsToday } from "@/lib/completions";
import { getAttempt } from "@/lib/attempts";
import { SECTIONS } from "@/lib/sections";
import { AppFrame } from "@/components/AppFrame";
import { GameHeader } from "@/components/GameHeader";
import { LitanyGame } from "./LitanyGame";

export const dynamic = "force-dynamic";

export default async function LitanyPage() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) redirect("/");

  const [completed, attempt] = await Promise.all([
    getCompletedSectionsToday(discordId),
    getAttempt(discordId, "litany"),
  ]);

  return (
    <AppFrame back={{ href: "/dashboard", label: "All trials" }}>
      <div className="container game-page">
        <GameHeader
          icon={Orbit}
          title="The Litany"
          reward={SECTIONS.litany.reward}
          date={getChallengeDateString()}
        />
        <div className="game-stage">
          <LitanyGame
            completedToday={completed.has("litany")}
            failedToday={attempt.failed}
          />
        </div>
      </div>
    </AppFrame>
  );
}
