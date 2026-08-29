"use server";

import { signIn, signOut } from "@/auth";

export async function doSignIn() {
  await signIn("discord", { redirectTo: "/dashboard" });
}

export async function doSignOut() {
  await signOut({ redirectTo: "/" });
}