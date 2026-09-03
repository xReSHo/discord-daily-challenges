import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Keyboard } from "lucide-react";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getCompletedSectionsToday } from "@/lib/completions";
import { getAttempt } from "@/lib/attempts";
import { prizeFor } from "@/lib/typing/game";
import { AppFrame } from "@/components/AppFrame";
import { GameHeader } from "@/components/GameHeader";
import { TypingTest } from "./TypingTest";

export const dynamic = "force-dynamic";

export default async function TypingPage() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) redirect("/");

  const [completed, attempt] = await Promise.all([
    getCompletedSectionsToday(discordId),
    getAttempt(discordId, "typing"),
  ]);

  return (
    <AppFrame back={{ href: "/dashboard", label: "All trials" }}>
      <div className="container game-page">
        <GameHeader
          icon={Keyboard}
          title="Typing Test"
          reward={prizeFor(attempt.fails)}
          date={getChallengeDateString()}
        />
        <div className="game-stage">
          <TypingTest
            completedToday={completed.has("typing")}
            failedToday={attempt.failed}
            prize={prizeFor(attempt.fails)}
            basePrize={prizeFor(0)}
          />
        </div>
      </div>
    </AppFrame>
  );
}
