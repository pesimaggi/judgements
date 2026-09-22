"use client";
import { useEffect, useState } from "react";
import { SignIn, SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppAuth } from "./AuthProvider";
import { readContinuation, safeReturnTo } from "@/lib/auth/continuation";

/** OAuth transfers and direct links have an in-app destination too. Usually
 * the reader stays inside the dialog; this handles redirects/new-user transfer
 * without ever using Clerk's separately branded Account Portal. */
export function AuthPage({ configured, signUp = false }: { configured: boolean; signUp?: boolean }) {
  const auth = useAppAuth();
  const router = useRouter();
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => {
    setReturnTo(readContinuation()?.returnTo ?? safeReturnTo(new URLSearchParams(window.location.search).get("redirect_url")));
  }, []);
  useEffect(() => {
    if (auth.signedIn && returnTo) router.replace(returnTo, { scroll: false });
  }, [auth.signedIn, returnTo, router]);
  return <main className="mx-auto w-full max-w-[440px] px-4 py-8">
    {!configured ? <p>Innskráning er ekki tilbúin. Leitin er áfram opin.</p>
      : (!auth.ready || !returnTo || auth.signedIn) ? <p role="status">Hleð innskráningu…</p>
      : signUp ? <SignUp routing="path" path="/sign-up" signInUrl="/sign-in"
          forceRedirectUrl={returnTo} signInForceRedirectUrl={returnTo} />
        : <SignIn routing="path" path="/sign-in" withSignUp transferable
          forceRedirectUrl={returnTo} signUpForceRedirectUrl={returnTo} />}
    <Link href={returnTo ?? "/"} onClick={auth.leaveSignIn} className="mt-4 inline-block text-sm text-inkSoft underline">Halda áfram án innskráningar</Link>
  </main>;
}
