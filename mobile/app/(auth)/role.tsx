import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth, type Me } from "@/auth";
import { TextLink } from "@/components/auth/AuthFields";
import {
  AuthAction,
  AuthFoot,
  AuthHeading,
  AuthScene,
  PickCard,
  type AuthTone,
} from "@/components/auth/AuthScene";
import { Notice, space } from "@/components/ui";
import type Ionicons from "@expo/vector-icons/Ionicons";
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
 *
 * It asks the same question the app opens on, so it is drawn with the same
 * cards — one hue each, a tick rather than a heavier border, and no literal
 * tick character glued to the title.
 */
const OPTIONS: {
  intent: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: AuthTone;
  title: string;
  body: string;
}[] = [
  {
    intent: "find_property",
    icon: "search",
    tone: "gold",
    title: "Find a property",
    body: "Browse freely and sign in only when you save, view or apply.",
  },
  {
    intent: "current_tenant",
    icon: "home",
    tone: "kola",
    title: "I'm a tenant",
    body: "Use a verified Unit access code to request the home where you live.",
  },
  {
    intent: "manage_property",
    icon: "business",
    tone: "lagoon",
    title: "I own/manage property",
    body: "Manage residential, commercial or hostel property.",
  },
];

export default function RoleScreen() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { refreshMe, signOut } = useAuth();
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
      <AuthScene>
        <AuthHeading
          title="Finishing your setup…"
          line="We are opening the experience you chose when you opened Danpa HQ."
        />
        {error ? <Notice tone="error" title={error} /> : null}
        {error ? (
          <AuthAction label="Try again" onPress={() => void retryAutomaticIntent()} busy={busy} />
        ) : null}
        <AuthFoot>
          <TextLink label="Sign out and return" muted onPress={() => void signOut()} />
        </AuthFoot>
      </AuthScene>
    );
  }

  return (
    <AuthScene progress={{ step: 2, of: 2 }}>
      <AuthHeading
        title="What are you here to do?"
        line="This opens the experience you need now. It does not permanently define your account."
      />

      <View style={{ gap: space[3] }} accessibilityRole="radiogroup">
        {OPTIONS.map((option) => (
          <PickCard
            key={option.intent}
            icon={option.icon}
            tone={option.tone}
            selected={selected === option.intent}
            title={option.title}
            body={option.body}
            onPress={() => setSelected(option.intent)}
          />
        ))}
      </View>

      {error ? <Notice tone="error" title={error} /> : null}

      <AuthAction label="Continue" busyLabel="Opening…" onPress={confirm} busy={busy} />

      <AuthFoot>
        <TextLink label="Sign out and return" muted onPress={() => void signOut()} />
      </AuthFoot>
    </AuthScene>
  );
}
