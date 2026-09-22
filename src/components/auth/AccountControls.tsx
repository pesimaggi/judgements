"use client";
import { useAppAuth } from "./AuthProvider";
export function AccountControls() {
  const auth = useAppAuth();
  return <>
    <button type="button" onClick={() => auth.run({ type: "open-saved" })} className="text-[#B9C7D4] hover:text-white">Vistað</button>
    {auth.signedIn ? <>
      <button type="button" onClick={auth.account} className="text-[#B9C7D4] hover:text-white">Aðgangur</button>
      <button type="button" onClick={auth.signOut} className="text-[#B9C7D4] hover:text-white">Skrá út</button>
    </> : <button type="button" onClick={auth.signIn} className="text-[#B9C7D4] hover:text-white">Skrá inn</button>}
  </>;
}
