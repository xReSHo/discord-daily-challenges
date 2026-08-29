import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Keyboard } from "lucide-react";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getCompletedSectionsToday } from "@/lib/completions";
import { SECTIONS } from "@/lib/sections";
import { AppFrame } from "@/components/AppFrame";
import { GameHeader } from "@/components/GameHeader";
import { TypingTest } from "./TypingTest";

export default async function TypingPage() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) redirect("/");

  const completed = await getCompletedSectionsToday(discordId);

  return (
    <AppFrame back={{ href: "/dashboard", label: "All trials" }}>
      <div className="container game-page">
        <GameHeader
          icon={Keyboard}
          title="Typing Test"
          reward={SECTIONS.typing.reward}
          date={getChallengeDateString()}
        />
        <div className="game-stage">
          <TypingTest completedToday={completed.has("typing")} />
        </div>
      </div>
    </AppFrame>
  );
}
