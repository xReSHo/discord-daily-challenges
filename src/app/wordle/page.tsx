import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { Grid3x3 } from "lucide-react";
import { getGameView } from "@/lib/wordle/game";
import { isDevMode } from "@/lib/dev-mode";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getSectionReward, getSectionStatus } from "@/lib/section-status";
import { AppFrame } from "@/components/AppFrame";
import { GameHeader } from "@/components/GameHeader";
import { SectionClosed } from "@/components/SectionClosed";
import { WordleBoard } from "./WordleBoard";

export default async function WordlePage() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) redirect("/");

  const [view, devMode, status, reward] = await Promise.all([
    getGameView(discordId),
    isDevMode(discordId),
    getSectionStatus("wordle"),
    getSectionReward("wordle"),
  ]);
  if (status.hidden) notFound();

  return (
    <AppFrame>
      <GameHeader
        icon={Grid3x3}
        title="Wordle"
        reward={reward}
        date={getChallengeDateString()}
        art="wordle"
      />
      <div className="container game-page">
        <div className="game-stage">
          {status.disabled ? (
            <SectionClosed title="Wordle" note={status.note} />
          ) : (
            <WordleBoard initialView={view} devMode={devMode} />
          )}
        </div>
      </div>
    </AppFrame>
  );
}
