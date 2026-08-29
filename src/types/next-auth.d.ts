import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      discordId?: string;
    } & DefaultSession["user"];
  }

  interface User {
    discordId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    discordId?: string;
  }
}
