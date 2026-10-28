import { useState } from "react";
import { Platform } from "react-native";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth, type Me } from "@/auth";
import { fieldErrorsFrom, type FieldErrors } from "@/formErrors";
import { resolveEntryRoute } from "@/navigation";
import { describeDevice } from "@/device";
import { isMFAChallenge, type MFAChallenge } from "@/mfa";
import type { CreatedSession } from "@/registrationDraft";

/**
 * Signing in, once.
 *
 * Everything that decides whether somebody is signed in, and where they land
 * afterwards, lives here. Authentication follows the backend entry route
 * without selecting a workspace or granting an account capability.
 */

export type SignInFlow = {
  mfa: MFAChallenge | null;
  cancelMfa: () => void;
  completeSignIn: (result: CreatedSession) => Promise<void>;
  identifier: string;
  setIdentifier: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  busy: boolean;
  error: string;
  fieldErrors: FieldErrors;
  /** Enough typed, and nothing already in flight. */
  ready: boolean;
  submit: () => Promise<void>;
};

export function useSignInFlow({
  initialPhone = "",
  onSignedIn,
}: {
  /**
   * Prefilled when someone arrives from a sign-up that turned out to already
   * have an account. Retyping a number they just typed is pure friction.
   */
  initialPhone?: string;
  /** Where to go once there is a session. Given the resolved entry route. */
  onSignedIn: (route: string) => void;
}): SignInFlow {
  const { signIn, deviceFingerprint } = useAuth();

  const [identifier, setIdentifierValue] = useState(initialPhone);
  const [password, setPasswordValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [mfa, setMfa] = useState<MFAChallenge | null>(null);

  // Typing is the retry. An error that outlives the thing it was about turns a
  // correction into an accusation.
  const setIdentifier = (value: string) => {
    setIdentifierValue(value);
    setFieldErrors({});
    if (error) setError("");
  };
  const setPassword = (value: string) => {
    setPasswordValue(value);
    setFieldErrors({});
    if (error) setError("");
  };

  const ready = Boolean(identifier.trim()) && Boolean(password) && !busy;

  async function submit() {
    setBusy(true);
    setError("");
    setFieldErrors({});
    try {
      const result = await apiFetch<MFAChallenge | {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        user: Me;
      }>("/auth/sign-in/", {
        method: "POST",
        anonymous: true,
        body: {
          identifier: identifier.trim(),
          password,
          platform: Platform.OS === "ios" ? "ios" : "android",
          // Which phone this is, not merely that it is one. Somebody reviewing
          // where their account is signed in has to recognise the device in
          // their hand — or fail to recognise one they have never held.
          device_label: describeDevice(),
          device_fingerprint: deviceFingerprint,
        },
      });
      if (isMFAChallenge(result)) { setMfa(result); setPasswordValue(""); return; }
      await completeSignIn(result);
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setFieldErrors(fields);
      setError(
        Object.keys(fields).length ? "" : cause instanceof ApiFailure ? cause.error.message : "Could not sign you in.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function completeSignIn(result: CreatedSession) {
      const user = result.user;
      const context = await signIn({ ...result, user });
      onSignedIn(resolveEntryRoute(user, context));
      setMfa(null);
  }

  return {
    mfa, cancelMfa: () => setMfa(null), completeSignIn,
    identifier,
    setIdentifier,
    password,
    setPassword,
    busy,
    error,
    fieldErrors,
    ready,
    submit,
  };
}
