import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth, type Me } from "@/auth";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { resolveEntryRoute } from "@/navigation";
import {
  asOnboardingIntent,
  clearPendingOnboardingIntent,
  pendingOnboardingIntent,
} from "@/onboardingIntent";
import { theme } from "@/theme";

export default function OnboardingScreen() {
  const router = useRouter();
  const { next, intent } = useLocalSearchParams<{ next?: string; intent?: string }>();
  const insets = useSafeAreaInsets();
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
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: space[5],
          paddingTop: insets.top + space[10],
          gap: space[5],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: space[2] }}>
          <Type variant="label">STEP 1 OF 2</Type>
          <Type variant="display2">What&apos;s your name?</Type>
          <Type variant="body" style={{ color: theme.color.ink["700"] }}>
            This creates your basic profile. We will not ask for identity documents here.
          </Type>
        </View>
        <Field label="First name" value={firstName} onChangeText={setFirstName} autoFocus />
        <Field label="Last name" value={lastName} onChangeText={setLastName} />
        <Field label="Preferred name (optional)" value={preferredName} onChangeText={setPreferredName} />
        {error ? <Notice tone="error" title={error} /> : null}
        <Button
          label="Continue"
          busy={busy}
          onPress={finish}
          disabled={!firstName.trim() || !lastName.trim()}
        />
        <Button
          label="Sign out and return"
          variant="quiet"
          icon={<Ionicons name="log-out-outline" size={20} color={theme.color.kola["600"]} />}
          onPress={() => void signOut().then(() => router.replace("/(auth)/welcome"))}
          disabled={busy}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
