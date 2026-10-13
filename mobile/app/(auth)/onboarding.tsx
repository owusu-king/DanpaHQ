import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth, type Me } from "@/auth";
import { TextLink } from "@/components/auth/AuthFields";
import {
  AuthAction,
  AuthField,
  AuthFields,
  AuthFoot,
  AuthHeading,
  AuthScene,
} from "@/components/auth/AuthScene";
import { Notice } from "@/components/ui";
import { resolveEntryRoute } from "@/navigation";
import {
  asOnboardingIntent,
  clearPendingOnboardingIntent,
  pendingOnboardingIntent,
} from "@/onboardingIntent";

/**
 * Finishing a profile that exists but has no name on it.
 *
 * Reached by an account the backend says is not done yet — a registration
 * interrupted, or one made before the current flow. It is part of the same
 * journey as sign-up and now looks like it: the same ground, the same grouped
 * fields, the same step marks, the same one act.
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const { next, intent } = useLocalSearchParams<{ next?: string; intent?: string }>();
  const { state, refreshMe, signOut } = useAuth();
  const me = state.status === "signed_in" ? state.me : null;
  const [preferredName, setPreferredName] = useState(me?.preferred_name ?? "");
  const [firstName, setFirstName] = useState(me?.first_name ?? "");
  const [lastName, setLastName] = useState(me?.last_name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function finish() {
    setBusy(true);
    setError("");
    try {
      let updated = await apiFetch<Me>("/me/onboarding/", {
        method: "POST",
        body: {
          preferred_name: preferredName,
          first_name: firstName,
          last_name: lastName,
        },
      });
      const selectedIntent = asOnboardingIntent(intent) ?? await pendingOnboardingIntent();
      if (updated.onboarding_state === "intent_required" && selectedIntent) {
        updated = await apiFetch<Me>("/me/onboarding/intent/", {
          method: "POST",
          body: { intent: selectedIntent },
        });
        await clearPendingOnboardingIntent();
      }
      await refreshMe(updated.default_context_id ?? updated.default_context ?? undefined);
      if (updated.onboarding_state === "intent_required") {
        router.replace({ pathname: "/(auth)/role", params: { next } });
      } else {
        router.replace(resolveEntryRoute(updated) as never);
      }
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScene progress={{ step: 1, of: 2 }}>
      <AuthHeading
        title="What's your name?"
        line="Your basic profile. We will not ask for identity documents here."
      />

      <AuthFields>
        <AuthField
          label="First name"
          icon="person-outline"
          placeholder="Ama"
          value={firstName}
          onChangeText={setFirstName}
          autoComplete="given-name"
          autoFocus
        />
        <AuthField
          label="Last name"
          icon="person-outline"
          placeholder="Mensah"
          value={lastName}
          onChangeText={setLastName}
          autoComplete="family-name"
        />
        <AuthField
          label="Preferred name (optional)"
          icon="happy-outline"
          placeholder="What we should call you"
          value={preferredName}
          onChangeText={setPreferredName}
        />
      </AuthFields>

      {error ? <Notice tone="error" title={error} /> : null}

      <AuthAction
        label="Continue"
        busyLabel="Saving…"
        busy={busy}
        onPress={finish}
        disabled={!firstName.trim() || !lastName.trim()}
      />

      <AuthFoot>
        <TextLink
          label="Sign out and return"
          muted
          onPress={() => void signOut().then(() => router.replace("/(auth)/sign-in"))}
        />
      </AuthFoot>
    </AuthScene>
  );
}
