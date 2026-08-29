import { createHash } from "node:crypto";
import { getOrCreateDailyContent } from "@/lib/daily-content";
import { PARAGRAPHS } from "./paragraphs";

const SEED = process.env.TYPING_SEED ?? "daily-challenges";
const SECTION = "typing";

/** Pure date -> paragraph mapping. Exported for verification scripts. */
export function deriveDailyParagraph(dateStr: string): string {
  const n = createHash("sha256")
    .update(`${SEED}:${dateStr}`)
    .digest()
    .readUIntBE(0, 6);
  return PARAGRAPHS[n % PARAGRAPHS.length];
}

type Payload = { text: string };

export async function getDailyParagraph(): Promise<string> {
  const payload = await getOrCreateDailyContent<Payload>(SECTION, (dateStr) => ({
    text: deriveDailyParagraph(dateStr),
  }));
  return payload.text;
}
