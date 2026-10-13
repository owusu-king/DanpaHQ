import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { TextLink } from "@/components/auth/AuthFields";
import { RoleCard } from "@/components/auth/AuthMotion";
import {
  AuthAction,
  AuthAside,
  AuthFoot,
  AuthHeading,
  AuthMark,
  AuthScene,
} from "@/components/auth/AuthScene";
import { WelcomeIntro } from "@/components/auth/WelcomeIntro";
import { Type, space } from "@/components/ui";
import { rememberOnboardingIntent, type OnboardingIntent } from "@/onboardingIntent";
import { theme } from "@/theme";

/**
 * The first thing anybody sees: one question, two answers.
 *
 * Tenant or provider. The answer is the account type, so the details screen
 * after this never asks it again — it used to, in a radio group above the name,
 * which made the opening question look like it had not been listened to.
 *
 * **The question is not a profile.** It is remembered as an onboarding intent —
 * the value the rest of the flow already reads — and carried forward as a
 * workspace, so the backend puts somebody where they asked to be.
 *
 * Choosing and continuing are two acts on purpose. A card that navigates on
 * touch gives no moment to see what was picked; here the choice settles — the
 * card fills, the tick lands — and Continue says where it leads.
 *
 * Browsing stays one line at the foot: it is a way of *using* Rooomly that asks
 * for no account at all, not a third kind of person to be.
 */

type Side = "tenant" | "provider";

const SIDES: Record<Side, {
  intent: OnboardingIntent;
  icon: "home" | "business";
  tone: { ink: string; wash: string; deep: string };
  title: string;
  body: string;
}> = {
  tenant: {
    intent: "current_tenant",
    icon: "home",
    tone: { ink: theme.color.kola["600"], wash: theme.color.kola["50"], deep: theme.color.kola["900"] },
    title: "Tenant",
    body: "Renting, or looking for a home.",
  },
  provider: {
    intent: "manage_property",
    icon: "business",
    tone: { ink: theme.color.lagoon["600"], wash: theme.color.lagoon["100"], deep: theme.color.lagoon["600"] },
    title: "Provider",
    body: "Owning or managing property.",
  },
};

export default function StartScreen() {
  const router = useRouter();
  const [side, setSide] = useState<Side | null>(null);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);

  /**
   * Remembered before leaving, because the details screen can also be reached
   * by the route gate, which arrives without parameters and reads it back.
   */
  async function proceed() {
    if (!side) return;
    setBusy(true);
    try {
      const intent = SIDES[side].intent;
      await rememberOnboardingIntent(intent);
      router.push({
        pathname: "/(auth)/register",
        params: { workspace: intent === "manage_property" ? "provider" : "tenant" },
      });
    } finally {
      setBusy(false);
    }
  }

  // A fresh install says hello on clean ivory before it asks anything; the
  // green hero starts at the question (owner, 2026-10-13).
  if (!choosing) {
    return (
      <WelcomeIntro
        onStart={() => setChoosing(true)}
        onSignIn={() => router.replace("/(auth)/sign-in")}
        onExplore={() => router.replace("/(app)/(tabs)/explore")}
      />
    );
  }

  return (
    <AuthScene>
      <AuthMark />

      <AuthHeading
        title={`How will you\nuse Rooomly?`}
        line="Choose one to start. You can add the other side later."
      />

      <View style={{ gap: space[3] }} accessibilityRole="radiogroup">
        {(Object.keys(SIDES) as Side[]).map((key) => (
          <RoleCard
            key={key}
            icon={SIDES[key].icon}
            tone={SIDES[key].tone}
            title={SIDES[key].title}
            body={SIDES[key].body}
            selected={side === key}
            onPress={() => setSide(key)}
          />
        ))}
      </View>

      <AuthAction
        label={side ? `Continue as ${SIDES[side].title.toLowerCase()}` : "Choose one to continue"}
        busyLabel="Opening…"
        onPress={() => void proceed()}
        busy={busy}
        disabled={!side}
      />

      {/* Somebody who has an account has already answered the question above,
          and should not have to answer it again to reach the front door. */}
      <AuthFoot>
        <AuthAside>
          <Type variant="caption">Already with us?</Type>
          <TextLink label="Sign in" strong onPress={() => router.push("/(auth)/sign-in")} />
        </AuthAside>
        <TextLink
          label="Just browsing? Explore homes"
          muted
          onPress={() => router.replace("/(app)/(tabs)/explore")}
        />
      </AuthFoot>
    </AuthScene>
  );
}
