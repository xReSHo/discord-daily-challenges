import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppFrame } from "@/components/AppFrame";
import { getBossState } from "@/lib/boss/game";
import { BossArena } from "./BossArena";

export const dynamic = "force-dynamic";

export default async function BossPage() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) redirect("/");

  const initial = await getBossState(discordId);

  return (
    <AppFrame raidAlert={false}>
      <BossArena initial={initial} />
    </AppFrame>
  );
}
