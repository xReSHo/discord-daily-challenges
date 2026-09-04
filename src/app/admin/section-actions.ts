"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { isSectionId } from "@/lib/sections";
import { setSectionStatus } from "@/lib/section-status";

/**
 * Admin game kill-switch. `toggleSection` flips a game's disabled state (and
 * stores the player-facing note). Form fields: `section`, `disabled` ("on" to
 * take it offline), `note`.
 */
export async function toggleSection(fd: FormData): Promise<void> {
  const session = await auth();
  if (!isAdmin(session?.user?.discordId)) throw new Error("Not authorized");

  const section = String(fd.get("section") ?? "");
  if (!isSectionId(section)) throw new Error("Unknown section");

  const disabled = fd.get("disabled") === "on";
  const note = String(fd.get("note") ?? "");

  await setSectionStatus(section, disabled, note);

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath(`/${section}`);
}
