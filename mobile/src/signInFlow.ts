import { useState } from "react";
import { Platform } from "react-native";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth, type Me, type Workspace } from "@/auth";
import { isNotAProvider } from "@/formErrors";
import { resolveEntryRoute } from "@/navigation";
import { describeDevice } from "@/device";
import { chooseWorkspace } from "@/workspace";

/**
 * Signing in, once.
 *
 * Everything that decides whether somebody is signed in, and where they land
 * afterwards, lives here: the one call to `/auth/sign-in/`, the workspace
 * request, the session and the entry route. The screen owns layout only.
 *
 * Nothing about the flow itself moved. The sequence below — sign in, then ask
 * for the workspace, then read the entry route — is the same sequence the
 * screen has always run, including the part that matters most: a session that
 * succeeded is kept even when the *requested experience* is refused.
 */

export type SignInFlow = {
  phone: string;
  setPhone: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  busy: boolean;
  error: string;
  /** Signed in, but this account cannot manage property. A fact, not a failure. */
  notAProvider: boolean;
  /** Enough typed, and nothing already in flight. */
  ready: boolean;
  submit: () => Promise<void>;
};

export function useSignInFlow({
  workspace,
  initialPhone = "",
  onSignedIn,
}: {
  /**
   * Which side of the relationship was asked for, or `null` when somebody
   * arrived at the front door without saying.
   */
  workspace: Workspace | null;
  /**
   * Prefilled when someone arrives from a sign-up that turned out to already
   * have an account. Retyping a number they just typed is pure friction.
   */
  initialPhone?: string;
  /** Where to go once there is a session. Given the resolved entry route. */
  onSignedIn: (route: string) => void;
}): SignInFlow {
  const { signIn, deviceFingerprint } = useAuth();

  const [phone, setPhoneValue] = useState(initialPhone);
  const [password, setPasswordValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notAProvider, setNotAProvider] = useState(false);

  // Typing is the retry. An error that outlives the thing it was about turns a
  // correction into an accusation.
  const setPhone = (value: string) => {
    setPhoneValue(value);
    if (error) setError("");
  };
  const setPassword = (value: string) => {
    setPasswordValue(value);
    if (error) setError("");
  };

  const hasPhone = Boolean(phone.trim());
  const ready = hasPhone && Boolean(password) && !busy;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{
        access_token: string;
        refresh_token: string;
        expires_in: number;
        user: Me;
      }>("/auth/sign-in/", {
        method: "POST",
        anonymous: true,
        body: {
          phone,
          password,
          platform: Platform.OS === "ios" ? "ios" : "android",
          // Which phone this is, not merely that it is one. Somebody reviewing
          // where their account is signed in has to recognise the device in
          // their hand — or fail to recognise one they have never held.
          device_label: describeDevice(),
          device_fingerprint: deviceFingerprint,
        },
      });

      let user = result.user;
      if (workspace) {
        try {
          user = await chooseWorkspace(workspace, result.access_token);
        } catch (cause) {
          if (isNotAProvider(cause)) {
            // The sign-in itself succeeded, so keep the session. Only the
            // requested experience is refused.
            await signIn(result);
            setNotAProvider(true);
            return;
          }
          throw cause;
        }
      }
      const context = await signIn({ ...result, user });
      onSignedIn(resolveEntryRoute(user, context));
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not sign you in.",
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    phone,
    setPhone,
    password,
    setPassword,
    busy,
    error,
    notAProvider,
    ready,
    submit,
  };
}

/**
 * What signing in leads to, said in the heading rather than in a line under it.
 *
 * "Use the number on your account and your password" used to sit underneath,
 * and the two labelled fields already said it.
 */
export function signInHeading(workspace: Workspace | null): string {
  if (workspace === "provider") return "Sign in to manage\nyour property";
  if (workspace === "tenant") return "Sign in to\nyour home";
  return "Welcome back";
}
