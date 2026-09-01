import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, type Workspace } from "@/auth";
import { PasswordField, PhoneField, TextLink } from "@/components/auth/AuthFields";
import { Button, Notice, Type, space } from "@/components/ui";
import { AuthCrest } from "@/components/welcome/AuthCrest";
import { signInHeading, useSignInFlow } from "@/signInFlow";
import { theme } from "@/theme";

/**
 * Sign in: a phone number and a password.
 *
 * The number says which account; the password says who is signing in. Those
 * were the same thing while sign-in was an SMS code, which made whoever held
 * the SIM the owner of the account.
 *
 * The `workspace` param carries a choice through — from the welcome screen's
 * cards, or from a sign-up that turned out to already have an account. Telling
 * the backend which experience was asked for, before reading the entry route,
 * is what stops an existing tenant who tapped "I manage property" being dropped
 * straight back into tenant space.
 *
 * **This is the front door.** The welcome journey hands its final choice here,
 * as do sign-out and every screen that needs a session. It carries the product's
 * face rather than opening on a bare form.
 *
 * Everything that decides who is signed in and where they land is in
 * `useSignInFlow`; the fields, down to the `+233`, are in `AuthFields`. This file
 * owns the focused screen layout and nothing else.
 *
 * The two things people actually come here needing — a forgotten password and a
 * new account — are one line each, not two more full-width buttons under the
 * one button that matters.
 */
export default function SignInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const params = useLocalSearchParams<{ workspace?: string; phone?: string }>();
  const passwordRef = useRef<TextInput>(null);

  const workspace: Workspace | null =
    params.workspace === "tenant" || params.workspace === "provider"
      ? params.workspace
      : null;

  const flow = useSignInFlow({
    workspace,
    // Prefilled when someone arrives from a sign-up that turned out to already
    // have an account. Retyping a number they just typed is pure friction.
    initialPhone: params.phone ?? "",
    onSignedIn: (route) => router.replace(route as never),
  });

  if (flow.notAProvider) {
    return (
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: space[5],
          paddingTop: insets.top + space[10],
          paddingBottom: insets.bottom + space[6],
          gap: space[5],
        }}
      >
        <View style={{ gap: space[3] }}>
          <Type variant="display2">This account rents,{"\n"}it does not let.</Type>
          <Type variant="body" style={{ color: theme.color.ink["700"] }}>
            You are signed in. Provider accounts are created at sign-up, so your home is
            what is waiting.
          </Type>
        </View>
        <Button
          label="Go to your home"
          onPress={() => router.replace("/(app)/(tabs)" as never)}
        />
        <TextLink
          label="Sign out"
          onPress={async () => {
            await signOut();
            // Sign-in, not the introduction: signing out does not un-introduce
            // somebody, and replaying it here would be a punishment for leaving.
            router.replace("/(auth)/sign-in");
          }}
        />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.color.field["50"] }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + space[6] }}
        keyboardShouldPersistTaps="handled"
      >
        <AuthCrest />

        <View style={{ padding: space[5], gap: space[5], flexGrow: 1 }}>
          <View style={{ gap: space[2] }}>
            <Type variant="display2" style={{ lineHeight: 38 }}>
              {signInHeading(workspace)}
            </Type>
            {workspace === "provider" ? (
              <Type variant="caption">
                Where your verification stands is the first thing you will see.
              </Type>
            ) : null}
          </View>

          <View style={{ gap: space[4] }}>
            <PhoneField
              value={flow.phone}
              onChangeText={flow.setPhone}
              onSubmitEditing={() => passwordRef.current?.focus()}
            />

            <View style={{ gap: space[2] }}>
              <PasswordField
                ref={passwordRef}
                value={flow.password}
                onChangeText={flow.setPassword}
                onSubmitEditing={() => flow.ready && void flow.submit()}
              />
              {/* Beside the thing it is about, not stacked with the actions. */}
              <View style={{ alignItems: "flex-end" }}>
                <TextLink
                  label="Forgot your password?"
                  onPress={() => router.push("/(auth)/forgot-password")}
                />
              </View>
            </View>
          </View>

          {flow.error ? <Notice tone="error" title={flow.error} /> : null}

          <Button
            label="Sign in"
            busyLabel="Signing in…"
            onPress={() => void flow.submit()}
            busy={flow.busy}
            disabled={!flow.ready}
          />

          <View style={{ flex: 1 }} />

          <View style={{ gap: space[4], alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <Type variant="caption">New to Rooomly?</Type>
              <TextLink
                label="Create an account"
                strong
                onPress={() =>
                  router.push({
                    pathname: "/(auth)/phone",
                    params: { workspace: workspace ?? undefined },
                  })
                }
              />
            </View>
            <TextLink
              label="Browse homes without an account"
              muted
              onPress={() => router.replace("/(app)/(tabs)/explore")}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
