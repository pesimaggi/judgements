import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";

const clerk = clerkMiddleware({
  authorizedParties: process.env.CLERK_AUTHORIZED_PARTIES?.split(",").map(s => s.trim()).filter(Boolean),
});

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  // Deploying before keys are configured must not take public research offline.
  // The private API independently fails closed when authentication is absent.
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) return NextResponse.next();
  return clerk(request, event);
}

// Public data endpoints deliberately do not depend on Clerk being available.
// Middleware supplies session context, but never turns a page into a login wall.
export const config = {
  matcher: ["/((?!api|_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/api/saved-documents(.*)"],
};
