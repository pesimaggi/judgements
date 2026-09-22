"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ClerkProvider, useAuth, useClerk } from "@clerk/nextjs";
import { usePathname, useRouter } from "next/navigation";
import { captureContinuation, currentPath, readContinuation, writeContinuation, type AuthAction, type Continuation } from "@/lib/auth/continuation";
import type { SavedDocument } from "@/lib/saved-documents";
import { AuthDialog } from "./AuthDialog";
import { appearance, localization } from "./clerk-ui";

interface AuthContextValue {
  signedIn: boolean;
  ready: boolean;
  items: SavedDocument[];
  itemsLoading: boolean;
  itemsError: string;
  busy: boolean;
  signIn: () => void;
  run: (action: AuthAction) => void;
  remove: (documentId: string) => Promise<void>;
  reload: () => Promise<void>;
  signOut: () => void;
  account: () => void;
  cancel: () => void;
  leaveSignIn: () => void;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export function useAppAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}

export function AuthProvider({ children, publishableKey }: { children: React.ReactNode; publishableKey: string | null }) {
  if (!publishableKey) return <AuthGate configured={false} ready userId={null}>{children}</AuthGate>;
  return <ClerkProvider publishableKey={publishableKey} localization={localization} appearance={appearance}
    signInUrl="/sign-in" signUpUrl="/sign-up">
    <ConnectedGate>{children}</ConnectedGate>
  </ClerkProvider>;
}
function ConnectedGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, userId } = useAuth();
  const clerk = useClerk();
  return <AuthGate configured ready={isLoaded} userId={userId ?? null}
    onSignOut={() => clerk.signOut({ redirectUrl: currentPath() })}
    onAccount={() => clerk.openUserProfile()}>{children}</AuthGate>;
}

// Exported for component tests, with no alternate authentication path in the app.
export function AuthGate({ children, configured, ready, userId, onSignOut, onAccount }: {
  children: React.ReactNode; configured: boolean; ready: boolean; userId: string | null;
  onSignOut?: () => Promise<void>; onAccount?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [intent, setIntent] = useState<Continuation | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState(false);
  const [collection, setCollection] = useState<{ owner: string | null; items: SavedDocument[] }>({ owner: null, items: [] });
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState("");
  const attempted = useRef<string | null>(null);
  const activeUser = useRef(userId);
  activeUser.current = userId;
  const inFlight = useRef(false);
  const listRequest = useRef(0);

  useEffect(() => {
    const stored = readContinuation();
    if (stored && (stored.returnTo === currentPath() || /^\/sign-(in|up)(\/|$)/.test(window.location.pathname))) setIntent(stored);
    else writeContinuation(null);
  }, []);

  const reload = useCallback(async () => {
    if (!userId) return;
    const owner = userId;
    const requestId = ++listRequest.current;
    setItemsLoading(true);
    setItemsError("");
    try {
      const response = await fetch("/api/saved-documents", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (activeUser.current === owner && requestId === listRequest.current) setCollection({ owner, items: data.items });
    } catch {
      if (activeUser.current === owner && requestId === listRequest.current) setItemsError("Ekki tókst að sækja vistaðar úrlausnir.");
    } finally { if (activeUser.current === owner && requestId === listRequest.current) setItemsLoading(false); }
  }, [userId]);
  useEffect(() => {
    setCollection({ owner: null, items: [] }); setItemsError("");
    if (userId) void reload(); else setItemsLoading(false);
  }, [userId, reload]);

  const cancel = useCallback(() => {
    setOpen(false); setIntent(null); setFailure(false); writeContinuation(null);
  }, []);

  async function execute(pending: Continuation) {
    if (inFlight.current || !userId) return;
    if (pending.userId && pending.userId !== userId) {
      cancel(); setNotice("Aðgangurinn breyttist. Veldu aðgerðina aftur fyrir þennan aðgang."); return;
    }
    inFlight.current = true; setBusy(true); setFailure(false); setOpen(false);
    const owner = userId;
    try {
      if (pending.action?.type === "save-document") {
        const response = await fetch("/api/saved-documents", { method: "PUT",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: pending.action.documentId }) });
        if (response.status === 401) {
          // Remember which account initiated an authenticated write, so a
          // subsequent account switch never silently writes to another user.
          const retry = { ...pending, userId: owner };
          setIntent(retry); writeContinuation(retry);
          setNotice("Innskráning rann út. Skráðu þig aftur inn til að ljúka vistun.");
          await onSignOut?.();
          return;
        }
        if (!response.ok) throw new Error();
        if (activeUser.current === owner) { setNotice("Úrlausnin hefur verið vistuð."); await reload(); }
      } else if (pending.action?.type === "open-saved") router.push("/saved");
      setIntent(null); writeContinuation(null);
    } catch {
      setFailure(true); setNotice("Ekki tókst að ljúka aðgerðinni. Þú getur reynt aftur.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  useEffect(() => {
    if (intent?.cancelled) {
      // The target page reads its view snapshot on mount before this parent
      // effect clears it. Cancellation must not also discard the filters.
      if (!/^\/sign-(in|up)(\/|$)/.test(window.location.pathname)) cancel();
      return;
    }
    if (ready && !userId && intent && !failure && !/^\/sign-(in|up)(\/|$)/.test(window.location.pathname)) {
      attempted.current = null;
      setOpen(true);
    }
    if (!ready || !userId || !intent || attempted.current === intent.id) return;
    // A dedicated fallback page must finish its redirect before consuming the
    // intent; otherwise the source page would lose its restoration snapshot.
    if (/^\/sign-(in|up)(\/|$)/.test(window.location.pathname)) return;
    attempted.current = intent.id;
    void execute(intent);
    // The intent is attempted once per login; failed writes require Retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, userId, intent, pathname]);

  function begin(action: AuthAction | null) {
    if (inFlight.current) return;
    const pending = captureContinuation(action, userId);
    attempted.current = null; setNotice(""); setFailure(false);
    setIntent(pending); writeContinuation(pending);
    if (!userId) setOpen(true);
  }
  async function remove(documentId: string) {
    if (!userId || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const response = await fetch("/api/saved-documents", { method: "DELETE",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId }) });
      if (!response.ok) throw new Error();
      await reload();
    } catch { setNotice("Ekki tókst að fjarlægja úrlausnina. Reyndu aftur."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <AuthContext.Provider value={{ signedIn: Boolean(userId), ready, busy,
    items: collection.owner === userId ? collection.items : [], itemsLoading, itemsError, reload, remove,
    signIn: () => begin(null), run: begin,
    signOut: () => { cancel(); setCollection({ owner: null, items: [] }); void onSignOut?.().catch(() => setNotice("Ekki tókst að skrá út. Reyndu aftur.")); },
    account: () => onAccount?.(), cancel,
    leaveSignIn: () => {
      const snapshot = intent ?? readContinuation();
      if (!snapshot) { cancel(); return; }
      const cancelled = { ...snapshot, action: null, cancelled: true };
      setOpen(false); setIntent(cancelled); writeContinuation(cancelled);
    },
  }}>
    {children}
    {open && intent && !userId && <AuthDialog intent={intent} configured={configured} ready={ready} onClose={cancel} />}
    {notice && <div role={failure ? "alert" : "status"} className="fixed bottom-5 left-4 z-50 max-w-[calc(100%-2rem)] rounded-[3px] border border-line bg-white p-4 text-sm text-ink shadow-lg">
      {notice}
      {failure && intent && <button className="ml-3 underline" onClick={() => void execute(intent)} disabled={busy}>Reyna aftur</button>}
      <button className="ml-3 text-inkSoft underline" onClick={() => { setNotice(""); if (failure) cancel(); }}>Loka</button>
    </div>}
  </AuthContext.Provider>;
}
