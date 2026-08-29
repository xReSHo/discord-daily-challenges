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
export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      authorization: { params: { scope: "identify" } },
      // providerAccountId is the Discord snowflake; store it on the user row.
      profile(profile) {
        const image = profile.avatar
          ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
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
