import { useEffect, useRef, useState } from "react";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { exchangeGoogleCredential, type GoogleRegistration } from "@/googleAuth";
import { resolveEntryRoute } from "@/navigation";
import type { AccountType, CreatedSession } from "@/registrationDraft";
import { isMFAChallenge, type MFAChallenge } from "@/mfa";

export function useGoogleSignInFlow({ accountType, onRegistration, onSignedIn }: {
  accountType?: AccountType;
  onRegistration: (registration: GoogleRegistration) => void;
  onSignedIn: (route: string) => void;
}) {
  const { signIn, deviceFingerprint } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mfa, setMfa] = useState<MFAChallenge | null>(null);
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function submit(credential: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const result = await exchangeGoogleCredential(credential, accountType, deviceFingerprint);
      if (!active.current) return;
      if (isMFAChallenge(result)) { setMfa(result); return; }
      if ("registration_required" in result) { onRegistration(result); return; }
      await completeSignIn(result);
    } catch (cause) {
      if (active.current) setError(cause instanceof ApiFailure ? cause.error.message : cause instanceof Error ? cause.message : "Could not sign you in with Google.");
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function completeSignIn(result: CreatedSession) {
      // A failed workspace preference must never discard a valid new session.
      const user = result.user;
      if (!active.current) return;
      const context = await signIn({ ...result, user });
      onSignedIn(resolveEntryRoute(user, context));
      setMfa(null);
  }
  return { submit, busy, error, mfa, cancelMfa: () => setMfa(null), completeSignIn };
}
