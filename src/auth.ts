import { avatarUrl } from "@/lib/discord";
import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

/**
 * Sessions are JWT-backed, not database-backed. With the DB far from the
 * server every query is expensive, and database sessions cost ~2 queries on
 * *every* request just to resolve `auth()`. The JWT carries the Discord id
 * directly, so authenticated requests hit the DB zero times for auth.
 *
 * The Prisma adapter is still used to persist users/accounts on sign-in.
 */
/**
 * The site only needs to know *who* signed in (the Discord id), never to call
 * Discord on the user's behalf. So the OAuth tokens are dropped before the
 * account row is written: a leaked database can't leak what it doesn't hold.
 */
const baseAdapter = PrismaAdapter(prisma);
const adapter: typeof baseAdapter = {
  ...baseAdapter,
  linkAccount(account) {
    return baseAdapter.linkAccount!({
      ...account,
      access_token: undefined,
      refresh_token: undefined,
      id_token: undefined,
      expires_at: undefined,
      session_state: undefined,
    });
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter,
  session: { strategy: "jwt" },
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      authorization: { params: { scope: "identify" } },
      // Discord now adds `iss=https://discord.com` to the OAuth callback.
      // Without a matching issuer here the callback is rejected and the user
      // lands on /api/auth/error?error=Configuration.
      issuer: "https://discord.com",
      // providerAccountId is the Discord snowflake; store it on the user row.
      profile(profile) {
        const image = profile.avatar
          ? avatarUrl(profile.id, profile.avatar)
          : null;
        return {
          id: profile.id,
          discordId: profile.id,
          name: profile.global_name ?? profile.username,
          image,
        };
      },
    }),
  ],
  events: {
    // The user row is written once, at first sign-in. Keep the name and the
    // picture in step with Discord every time they sign in after that.
    async signIn({ user, profile }) {
      const p = profile as { id?: string; avatar?: string | null; global_name?: string | null; username?: string } | undefined;
      if (!user.id || !p?.id) return;
      await prisma.user
        .updateMany({
          where: { id: user.id },
          data: {
            image: p.avatar ? avatarUrl(p.id, p.avatar) : null,
            name: p.global_name ?? p.username ?? undefined,
          },
        })
        .catch(() => {});
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      // On sign-in `user` is the freshly created/looked-up row.
      if (user) {
        token.discordId =
          (user as { discordId?: string | null }).discordId ?? token.discordId;
      }
      // Backfill for tokens/users created before `discordId` was populated.
      // Runs at most once per user, then the value lives in the token.
      if (!token.discordId && token.sub) {
        const account = await prisma.account.findFirst({
          where: { userId: token.sub, provider: "discord" },
          select: { providerAccountId: true },
        });
        if (account) token.discordId = account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.discordId =
          typeof token.discordId === "string" ? token.discordId : undefined;
        if (typeof token.sub === "string") session.user.id = token.sub;
      }
      return session;
    },
  },
});
