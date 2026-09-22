import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth, type Me } from "@/auth";
import { Button, Notice, Type, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";
import {
  clearPendingOnboardingIntent,
  pendingOnboardingIntent,
  type OnboardingIntent,
} from "@/onboardingIntent";

/**
 * Asked once, after the number is confirmed, and only for a new account.
 *
 * Framed as "what brings you here" rather than "choose your account type",
 * because people do not think of themselves as a role. It is also reversible and
 * additive: someone who rents a room and lets another can hold both, and the
 * copy says so rather than making the choice feel permanent.
 */
const OPTIONS = [
  {
    intent: "find_property",
    title: "Find a property",
    body: "Browse freely and sign in only when you save, view or apply.",
  },
  {
    intent: "current_tenant",
    title: "I'm a tenant",
    body: "Use a verified Unit access code to request the home where you live.",
  },
  {
    intent: "manage_property",
    title: "I own/manage property",
    body: "Manage residential, commercial or hostel property.",
  },
];

export default function RoleScreen() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { refreshMe, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState(
    next === "/(app)/private-property"
      ? "manage_property"
      : next === "/(app)/tenant-setup"
        ? "current_tenant"
        : "find_property",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkingPending, setCheckingPending] = useState(true);
  const [automaticIntent, setAutomaticIntent] = useState<OnboardingIntent | null>(null);

  const applyIntent = useCallback(async (chosen: string) => {
    const me = await apiFetch<Me>("/me/onboarding/intent/", {
      method: "POST",
      body: { intent: chosen },
    });
    await clearPendingOnboardingIntent();
    await refreshMe(me.default_context_id ?? me.default_context ?? undefined);
    router.replace(me.entry_routes.mobile as never);
  }, [refreshMe, router]);

  useEffect(() => {
    let active = true;
    void pendingOnboardingIntent().then(async (pending) => {
      if (!active) return;
      if (!pending) {
        setCheckingPending(false);
        return;
      }
      setAutomaticIntent(pending);
      setBusy(true);
      try {
        await applyIntent(pending);
      } catch (cause) {
        if (active) {
          setError(cause instanceof ApiFailure ? cause.error.message : "That did not work.");
        }
      } finally {
        if (active) setBusy(false);
      }
    });
    return () => { active = false; };
  }, [applyIntent]);

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await applyIntent(selected);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function retryAutomaticIntent() {
    if (!automaticIntent) return;
    setBusy(true);
    setError("");
    try {
      await applyIntent(automaticIntent);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (checkingPending) {
    return (
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: space[5],
          paddingTop: insets.top + space[10],
          paddingBottom: insets.bottom + space[6],
          gap: space[4],
        }}
      >
        <Type variant="display2">Finishing your setup…</Type>
        <Type variant="body">We are opening the experience you selected on the welcome screen.</Type>
        {error ? <Notice tone="error" title={error} /> : null}
        {error ? <Button label="Try again" onPress={() => void retryAutomaticIntent()} busy={busy} /> : null}
        <Button
          label="Sign out and return"
          variant="quiet"
          onPress={() => void signOut()}
          disabled={busy}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{
        padding: space[5],
        paddingTop: insets.top + space[10],
        paddingBottom: insets.bottom + space[6],
        gap: space[5],
      }}
    >
      <View style={{ gap: space[3] }}>
        <Type variant="label">STEP 2 OF 2</Type>
        <Type variant="display2">What are you here to do?</Type>
        <Type variant="body" style={{ color: theme.color.ink["700"] }}>
          This opens the experience you need now. It does not permanently define your account.
        </Type>
      </View>

      <View style={{ gap: space[3] }} accessibilityRole="radiogroup">
        {OPTIONS.map((option) => {
          const active = selected === option.intent;
          return (
            <Pressable
              key={option.intent}
              onPress={() => setSelected(option.intent)}
              accessibilityRole="radio"
              aria-selected={active}
              {...pressableFeedback(theme.color.kola["50"])}
              style={{
                padding: space[4],
                borderRadius: 8,
                borderWidth: active ? 2 : 1,
                borderColor: active ? theme.color.kola["600"] : theme.color.field["200"],
                backgroundColor: active ? theme.color.kola["50"] : theme.color.field["0"],
                gap: space[2],
              }}
            >
              <Type variant="bodyStrong">{option.title}</Type>
              <Type variant="caption">{option.body}</Type>
            </Pressable>
          );
        })}
      </View>

      {error ? <Notice tone="error" title={error} /> : null}
      <Button label="Continue" onPress={confirm} busy={busy} />
      <Button
        label="Sign out and return"
        variant="quiet"
        icon={<Ionicons name="log-out-outline" size={20} color={theme.color.kola["600"]} />}
        onPress={() => void signOut()}
        disabled={busy}
      />
    </ScrollView>
  );
}
