import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { TextInput, View } from "react-native";

import { useAuth, type Workspace } from "@/auth";
import { DIAL_CODE, TextLink } from "@/components/auth/AuthFields";
import {
  AuthAction,
  AuthAside,
  AuthField,
  AuthFields,
  AuthFoot,
  AuthHeading,
  AuthMark,
  AuthScene,
  RevealToggle,
} from "@/components/auth/AuthScene";
import { Notice, Type, space } from "@/components/ui";
import { phoneInputProps } from "@/platform";
import { signInHeading, useSignInFlow } from "@/signInFlow";

/**
 * Sign in: a phone number and a password.
 *
 * The number says which account; the password says who is signing in. Those
 * were the same thing while sign-in was an SMS code, which made whoever held
 * the SIM the owner of the account.
 *
 * The `workspace` param carries a choice through — from the question the app
 * opens on, or from a sign-up that turned out to already have an account.
 * Telling the backend which experience was asked for, before reading the entry
 * route, is what stops an existing tenant who tapped "I manage property" being
 * dropped straight back into tenant space.
 *
 * **This is the front door**, so it is the screen the whole flow's composition
 * was designed around: mark, heading, one line, the credential as a single
 * surface, the one act, then the ways on. The two fields are one card because
 * they are one credential — a number and a password for it — and separating
 * them into two bordered boxes made the page read as a form to be filled in
 * rather than as a door to be opened.
 *
 * Everything that decides who is signed in and where they land is in
 * `useSignInFlow`. This file owns the screen and nothing else.
 */
export default function SignInScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const params = useLocalSearchParams<{ workspace?: string; phone?: string }>();
  const passwordRef = useRef<TextInput>(null);
  const [reveal, setReveal] = useState(false);

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
      <AuthScene>
        <AuthMark />
        <AuthHeading
          title={`This account rents,\nit does not let.`}
          line="You are signed in. Provider accounts are created at sign-up, so your home is what is waiting."
        />
        <AuthAction
          label="Go to your home"
          onPress={() => router.replace("/(app)/(tabs)" as never)}
        />
        <AuthFoot>
          <TextLink
            label="Sign out"
            muted
            onPress={async () => {
              await signOut();
              // Sign-in, not the opening question: signing out does not undo
              // knowing what somebody came here for.
              router.replace("/(auth)/sign-in");
            }}
          />
        </AuthFoot>
      </AuthScene>
    );
  }

  return (
    <AuthScene>
      <AuthMark />

      <AuthHeading
        title={signInHeading(workspace)}
        line={
          workspace === "provider"
            ? "Your verification status comes first."
            : "Your number and your password."
        }
      />

      {/* Two surfaces, not one with a hairline through it. They are a pair, but
          they are answered at different moments — the number is recalled, the
          password is recited — and joining them made the screen read as a
          single block of typing rather than as two things to do. */}
      <View style={{ gap: space[3] }}>
        <AuthFields>
          <AuthField
            label="Mobile number"
            icon="call-outline"
            prefix={DIAL_CODE}
            placeholder="24 123 4567"
            value={flow.phone}
            onChangeText={flow.setPhone}
            maxLength={15}
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            {...phoneInputProps}
          />
        </AuthFields>
        <AuthFields>
          <AuthField
            ref={passwordRef}
            label="Password"
            icon="lock-closed-outline"
            value={flow.password}
            onChangeText={flow.setPassword}
            secureTextEntry={!reveal}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => flow.ready && void flow.submit()}
            action={<RevealToggle shown={reveal} onPress={() => setReveal((shown) => !shown)} />}
          />
        </AuthFields>
      </View>

      {flow.error ? <Notice tone="error" title={flow.error} /> : null}

      <AuthAction
        label="Sign in"
        busyLabel="Signing in…"
        onPress={() => void flow.submit()}
        busy={flow.busy}
        disabled={!flow.ready}
      />

      <AuthFoot>
        <TextLink
          label="Forgot your password?"
          onPress={() => router.push("/(auth)/forgot-password")}
        />
        <AuthAside>
          <Type variant="caption">New to Danpa HQ?</Type>
          <TextLink
            label="Create an account"
            strong
            // Into the journey at the right step: the details when the question
            // was already answered on the way here, the question when it was not.
            onPress={() =>
              workspace
                ? router.push({ pathname: "/(auth)/register", params: { workspace } })
                : router.push("/(auth)/start")
            }
          />
        </AuthAside>
        <TextLink
          label="Browse homes without an account"
          muted
          onPress={() => router.replace("/(app)/(tabs)/explore")}
        />
      </AuthFoot>
    </AuthScene>
  );
}
