import { useRouter } from "expo-router";
import { View } from "react-native";

import { TextLink } from "@/components/auth/AuthFields";
import {
  AuthAside,
  AuthFoot,
  AuthHeading,
  AuthMark,
  AuthScene,
  ChoiceCard,
} from "@/components/auth/AuthScene";
import { Type, space } from "@/components/ui";
import { rememberOnboardingIntent, type OnboardingIntent } from "@/onboardingIntent";

/**
 * The first thing anybody sees: one question, three ways in.
 *
 * This replaces a three-scene introduction that swiped through a neighbourhood,
 * a living room and a portfolio before arriving at exactly this question. The
 * scenes were built to carry illustrations that were never drawn, so what a
 * launch actually showed was three tonal washes and two taps of nothing, and a
 * returning person had to be specially exempted from it by a flag kept in the
 * keychain. Asking the question immediately is both the better first launch and
 * the better second one, and it deletes the exemption along with the story.
 *
 * **The question is not a profile.** It is remembered as an onboarding intent —
 * the value the rest of the flow already reads — and carried into sign-in as a
 * workspace, so the backend puts somebody where they asked to be rather than
 * inferring it from whatever they last were. Nobody is locked into the answer;
 * `register` offers it again, and an account can hold both sides.
 *
 * Browsing is here because it is a way of *using* Rooomly, not a third kind of
 * person to be — so it is drawn quieter than the two that start a relationship,
 * and it asks for no account and no workspace.
 */
export default function StartScreen() {
  const router = useRouter();

  /**
   * Which side of the tenancy this person is on.
   *
   * Remembered before leaving, because the register screen can also be reached
   * by the route gate, which arrives without parameters and reads it back.
   */
  async function choose(intent: OnboardingIntent) {
    await rememberOnboardingIntent(intent);

    // The one way in that asks nothing of anybody.
    if (intent === "find_property") {
      router.replace("/(app)/(tabs)/explore");
      return;
    }

    router.push({
      pathname: "/(auth)/sign-in",
      params: { workspace: intent === "manage_property" ? "provider" : "tenant" },
    });
  }

  return (
    <AuthScene>
      <AuthMark />

      <AuthHeading
        title={`How will you\nuse Rooomly?`}
        line="You can do more than one later."
      />

      <View style={{ gap: space[3] }}>
        <ChoiceCard
          icon="home"
          tone="kola"
          title="I'm renting"
          body="My home, my agreement, my rent"
          onPress={() => void choose("current_tenant")}
        />
        <ChoiceCard
          icon="business"
          tone="lagoon"
          title="I manage property"
          body="Properties, Units and tenants"
          onPress={() => void choose("manage_property")}
        />
        <ChoiceCard
          icon="search"
          tone="gold"
          title="Just browsing"
          body="Public homes · no account needed"
          quiet
          onPress={() => void choose("find_property")}
        />
      </View>

      {/* Somebody who has an account has already answered the question above,
          and should not have to answer it again to reach the front door. */}
      <AuthFoot>
        <AuthAside>
          <Type variant="caption">Already with us?</Type>
          <TextLink label="Sign in" strong onPress={() => router.push("/(auth)/sign-in")} />
        </AuthAside>
      </AuthFoot>
    </AuthScene>
  );
}
