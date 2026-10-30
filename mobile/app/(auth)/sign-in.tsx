import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { MFASignIn } from "@/components/auth/MFASignIn";
import { useGoogleSignInFlow } from "@/googleSignInFlow";
import { TextLink } from "@/components/auth/AuthFields";
import {
  AuthAction,
  AuthAside,
  AuthField,
  AuthFields,
  AuthFoot,
  AuthMark,
  AuthScene,
  RevealToggle,
} from "@/components/auth/AuthScene";
import { Notice, Type, space } from "@/components/ui";
import { useSignInFlow } from "@/signInFlow";
import { theme } from "@/theme";

/**
 * Sign in: a phone number and a password.
 *
 * The number says which account; the password says who is signing in. Those
 * were the same thing while sign-in was an SMS code, which made whoever held
 * the SIM the owner of the account.
 *
 * Login follows the existing account; account type is chosen at registration.
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
  const params = useLocalSearchParams<{ workspace?: string; next?: string; phone?: string }>();
  const passwordRef = useRef<TextInput>(null);
  const [reveal, setReveal] = useState(false);

  const flow = useSignInFlow({
    // Prefilled when someone arrives from a sign-up that turned out to already
    // have an account. Retyping a number they just typed is pure friction.
    initialPhone: params.phone ?? "",
    onSignedIn: (route) => router.replace((params.next?.startsWith("/(app)/") || params.next?.startsWith("/listing/") || params.next?.startsWith("/search") || params.next?.startsWith("/sale/") ? params.next : route) as never),
  });
  const google = useGoogleSignInFlow({
    onRegistration: (result) => {
      router.push({ pathname: "/(auth)/start", params: { step: "role" } });
    },
    onSignedIn: (route) => router.replace((params.next?.startsWith("/(app)/") || params.next?.startsWith("/listing/") || params.next?.startsWith("/search") || params.next?.startsWith("/sale/") ? params.next : route) as never),
  });

  if (flow.mfa) return <MFASignIn initial={flow.mfa} onComplete={flow.completeSignIn} onCancel={flow.cancelMfa} />;
  if (google.mfa) return <MFASignIn initial={google.mfa} onComplete={google.completeSignIn} onCancel={google.cancelMfa} />;

  return (
    <AuthScene>
      <AuthMark centered />

      {/* Two surfaces, not one with a hairline through it. They are a pair, but
          they are answered at different moments — the number is recalled, the
          password is recited — and joining them made the screen read as a
          single block of typing rather than as two things to do. */}
      <View style={{ gap: space[3] }}>
        <AuthFields compact>
          <AuthField
            label="Email or Phone"
            hideLabel
            compact
            icon="person-outline"
            placeholder="Email or Phone"
            value={flow.identifier}
            onChangeText={flow.setIdentifier}
            error={flow.fieldErrors.identifier}
            maxLength={254}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
        </AuthFields>
        <AuthFields compact>
          <AuthField
            ref={passwordRef}
            label="Password"
            hideLabel
            compact
            placeholder="Password"
            icon="lock-closed-outline"
            value={flow.password}
            onChangeText={flow.setPassword}
            error={flow.fieldErrors.password}
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
        disabled={!flow.ready || google.busy}
      />

      <View style={{ gap: space[3] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
          <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.color.field["200"] }} />
          <Type variant="caption" style={{ color: theme.color.ink["500"] }}>or</Type>
          <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.color.field["200"] }} />
        </View>
        <GoogleSignInButton onCredential={google.submit} disabled={flow.busy || google.busy} />
        {google.error ? <Notice tone="error" title={google.error} /> : null}
      </View>

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
            onPress={() => router.push({ pathname: "/(auth)/start", params: { step: "role" } })}
          />
        </AuthAside>
      </AuthFoot>
    </AuthScene>
  );
}
