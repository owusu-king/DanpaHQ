import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiBaseUrl, apiFetch, ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { isAccountExists } from "@/formErrors";
import { asOnboardingIntent, pendingOnboardingIntent } from "@/onboardingIntent";
import { phoneInputProps } from "@/platform";
import { theme } from "@/theme";

/**
 * The first screen. It has one job: get a phone number, correctly, from someone
 * who may be standing in the sun on a cracked screen.
 *
 * Decisions that matter here:
 *
 * - **One field.** No email, no password, no name. Everything else can wait
 *   until after we know how to reach them.
 * - **The +233 is fixed and shown, not typed.** People type 0241234567; the
 *   prefix is display, and the server normalises either way.
 * - **We say what happens next before it happens.** "We'll text you a code" sets
 *   the expectation, so waiting for an SMS is not a mystery.
 * - **This is registration, not sign-in.** Proving a number establishes which
 *   account is being created; it is no longer a way into an existing one. An
 *   account that already exists is sent to the password screen instead.
 */
export default function PhoneScreen() {
  const router = useRouter();
  const { next, intent, workspace } = useLocalSearchParams<{
    next?: string;
    intent?: string;
    workspace?: string;
  }>();
  const { deviceFingerprint } = useAuth();
  const insets = useSafeAreaInsets();

  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unreachable, setUnreachable] = useState("");
  // Not an error: the number is fine, it simply already belongs to someone. The
  // server tells us this instead of sending a code, so the person finds out
  // here rather than after waiting for an SMS and typing six digits.
  const [accountExists, setAccountExists] = useState(false);

  const digits = phone.replace(/\D/g, "");
  const looksComplete = digits.length >= 9;

  async function requestCode() {
    setBusy(true);
    setError("");
    try {
      const selectedIntent = asOnboardingIntent(intent) ?? await pendingOnboardingIntent();
      const result = await apiFetch<{
        challenge_id: string;
        phone_display: string;
        expires_in: number;
        resend_in: number;
      }>("/auth/challenge/", {
        method: "POST",
        anonymous: true,
        body: { phone, purpose: "sign_up", device_fingerprint: deviceFingerprint },
      });

      router.push({
        pathname: "/(auth)/code",
        params: {
          challengeId: result.challenge_id,
          phoneDisplay: result.phone_display,
          expiresIn: String(result.expires_in),
          resendIn: String(result.resend_in),
          purpose: "sign_up",
          next,
          intent: selectedIntent ?? undefined,
          workspace,
        },
      });
    } catch (cause) {
      if (isAccountExists(cause)) {
        setAccountExists(true);
        return;
      }
      setError(
        cause instanceof ApiFailure
          ? cause.error.message
          : "Something went wrong. Try again.",
      );
      // A connection that never opened is almost always the app pointing at the
      // wrong machine, so say which one it tried rather than leaving the user to
      // guess. Dev builds only - this is a diagnostic, not product copy.
      if (__DEV__ && cause instanceof ApiFailure && cause.status === 0) {
        setUnreachable(apiBaseUrl());
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: space[5],
          paddingTop: insets.top + space[12],
          paddingBottom: insets.bottom + space[6],
          gap: space[6],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Button
          label="Back to welcome"
          variant="quiet"
          icon={<Ionicons name="arrow-back" size={20} color={theme.color.kola["600"]} />}
          onPress={() => router.replace("/(auth)/welcome")}
        />

        <View style={{ gap: space[3] }}>
          <Type variant="label">STEP 1 OF 3</Type>
          <Type variant="display2">Create your account</Type>
          <Type variant="body" style={{ color: theme.color.ink["700"] }}>
            Enter your mobile number. We&apos;ll text a six-digit code to confirm it belongs to you.
          </Type>
        </View>

        <Field
          label="Mobile number"
          prefix="+233"
          placeholder="24 123 4567"
          value={phone}
          onChangeText={(value) => {
            setPhone(value);
            setAccountExists(false);
            if (error) setError("");
          }}
          error={error}
          autoFocus
          maxLength={15}
          returnKeyType="go"
          onSubmitEditing={() => looksComplete && !busy && requestCode()}
          {...phoneInputProps}
        />

        {unreachable ? (
          <Notice
            tone="warning"
            title="The app could not reach the server"
            body={`It tried ${unreachable}. If you are on a real phone, start Expo with EXPO_PUBLIC_API_URL set to your computer's address on this network, and check the two are on the same Wi-Fi.`}
          />
        ) : null}

        {accountExists ? (
          <>
            <Notice
              tone="info"
              title="You already have an account"
              body="This mobile number is already registered. Sign in instead to continue."
            />
            <Button
              label="Sign in instead"
              onPress={() =>
                router.replace({
                  pathname: "/(auth)/sign-in",
                  params: { phone, workspace },
                })
              }
            />
          </>
        ) : (
          <Button
            label="Continue"
            busyLabel="Sending…"
            onPress={requestCode}
            busy={busy}
            disabled={!looksComplete}
          />
        )}

        <View style={{ flex: 1 }} />

        <Notice
          tone="info"
          title="We will never ask you for your code"
          body="Not by call, not by message. Anyone who does is trying to take your account."
        />

        <Type variant="caption" style={{ textAlign: "center" }}>
          Standard SMS rates from your network may apply.
        </Type>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
