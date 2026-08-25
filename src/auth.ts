import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      // Only request what we need: identify = basic profile (id, username, avatar)
      authorization: { params: { scope: "identify" } },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      // Expose discordId on the session so API routes can use it directly.
      // AdapterUser's TS type doesn't know about our custom `discordId`
      // column, so we look it up explicitly rather than casting blindly.
      if (session.user) {
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { discordId: true },
        });
        (session.user as typeof session.user & { discordId?: string }).discordId =
          dbUser?.discordId ?? undefined;
      }
      return session;
    },
    async signIn({ user, account }) {
      // Store the Discord user id on our User row the first time they log in
      if (account?.provider === "discord" && account.providerAccountId && user.id) {
        await prisma.user.update({
          where: { id: user.id },
          data: { discordId: account.providerAccountId },
        });
      }
      return true;
    },
  },
  session: { strategy: "database" },
});
