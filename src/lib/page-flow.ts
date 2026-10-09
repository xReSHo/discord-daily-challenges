import type { ArtKey } from "@/lib/art";

/**
 * The main pages, in the order of the header's links, ending with the player's
 * own record (the portrait at the end of the header). Scrolling on past the
 * bottom of one leads into the next, and past the top into the one before
 * (see components/PageFlow). The admin pages and the games are not part of it.
 */
export type FlowStop = { href: string; art: ArtKey; eyebrow: string; title: string };

export const FLOW: FlowStop[] = [
  { href: "/dashboard", art: "trials", eyebrow: "The Trials", title: "Today’s grace" },
  { href: "/duel", art: "pit", eyebrow: "The Pit", title: "Stake and steel" },
  { href: "/shop", art: "shop", eyebrow: "The Emporium", title: "Merchant’s wares" },
  { href: "/leaderboard", art: "leaderboard", eyebrow: "The faithful", title: "Streak leaderboard" },
  { href: "/achievements", art: "achievements", eyebrow: "Your feats", title: "Achievements" },
  { href: "/me", art: "hero", eyebrow: "Your record", title: "The chronicle" },
];

export function flowNeighbours(href: string): { prev?: FlowStop; next?: FlowStop } {
  const i = FLOW.findIndex((s) => s.href === href);
  if (i < 0) return {};
  return { prev: FLOW[i - 1], next: FLOW[i + 1] };
}
