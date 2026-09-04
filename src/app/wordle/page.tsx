import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Grid3x3 } from "lucide-react";
import { getGameView } from "@/lib/wordle/game";
import { isDevMode } from "@/lib/dev-mode";
import { getChallengeDateString } from "@/lib/challenge-date";
import { SECTIONS } from "@/lib/sections";
import { getSectionStatus } from "@/lib/section-status";
import { AppFrame } from "@/components/AppFrame";
import { GameHeader } from "@/components/GameHeader";
import { SectionClosed } from "@/components/SectionClosed";
import { WordleBoard } from "./WordleBoard";

export default async function WordlePage() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) redirect("/");

  const [view, devMode, status] = await Promise.all([
    getGameView(discordId),
    isDevMode(discordId),
    getSectionStatus("wordle"),
  ]);

  return (
    <AppFrame back={{ href: "/dashboard", label: "All trials" }}>
      <div className="container game-page">
        <GameHeader
          icon={Grid3x3}
          title="Wordle"
          reward={SECTIONS.wordle.reward}
          date={getChallengeDateString()}
        />
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
