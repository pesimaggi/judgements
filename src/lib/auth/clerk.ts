import "server-only";
import { auth } from "@clerk/nextjs/server";

export function clerkConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

/** Identity comes only from Clerk's verified session. No email matching, local
 * credentials, browser-provided user IDs or duplicated user table are needed. */
export async function authenticatedUserId(): Promise<string | null> {
  if (!clerkConfigured()) return null;
  const { userId } = await auth();
  return userId;
}
