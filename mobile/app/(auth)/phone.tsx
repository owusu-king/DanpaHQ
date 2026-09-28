import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import { apiBaseUrl, apiFetch, ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { DIAL_CODE, TextLink } from "@/components/auth/AuthFields";
import {
  AuthAction,
  AuthAside,
  AuthBack,
  AuthField,
  AuthFields,
  AuthFoot,
  AuthHeading,
  AuthScene,
} from "@/components/auth/AuthScene";
import { Notice, Type } from "@/components/ui";
import { isAccountExists } from "@/formErrors";
import { asOnboardingIntent, pendingOnboardingIntent } from "@/onboardingIntent";
import { phoneInputProps } from "@/platform";

/**
 * Step one of creating an account. It has one job: get a phone number,
 * correctly, from someone who may be standing in the sun on a cracked screen.
 *
 * Decisions that matter here:
 *
 * - **One field.** No email, no password, no name. Everything else can wait
 *   until after we know how to reach them.
 * - **The +233 is fixed and shown, not typed.** People type 0241234567; the
 *   prefix is display, and the server normalises either way.
 * - **We say what happens next before it happens.** The supporting line sets the
 *   expectation, so waiting for an SMS is not a mystery.
 * - **This is registration, not sign-in.** Proving a number establishes which
 *   account is being created; it is no longer a way into an existing one. An
 *   account that already exists is sent to the password screen instead.
 *
 * The way out is a mark in the corner. It used to be a full-width quiet button
 * reading "Back to welcome" — the widest control on a screen whose whole point
 * is the one field under it, and the loudest thing on the page was leaving. The
 * two reassurances at the foot were a four-line notice and a line of small
 * print; they are one line now, because a person is here to type nine digits.
 */
export default function PhoneScreen() {
  const router = useRouter();
  const { next, intent, workspace } = useLocalSearchParams<{
    next?: string;
    intent?: string;
    workspace?: string;
  }>();
  const { deviceFingerprint } = useAuth();

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
    <AuthScene
      progress={{ step: 1, of: 3 }}
      header={<AuthBack label="Back to the start" onPress={() => router.replace("/(auth)/start")} />}
    >
      <AuthHeading
        title="Create your account"
        line="We'll text a six-digit code to confirm your number."
      />

      <AuthFields>
        <AuthField
          label="Mobile number"
          icon="call-outline"
          prefix={DIAL_CODE}
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
      </AuthFields>

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
            body="This number is registered. Sign in instead to continue."
          />
          <AuthAction
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
        <AuthAction
          label="Continue"
          busyLabel="Sending…"
          onPress={requestCode}
          busy={busy}
          disabled={!looksComplete}
        />
      )}

      <AuthFoot>
        {/* The one thing worth saying at the foot of this screen. It used to be
            a four-line notice plus a line of small print about SMS rates. */}
        <Type variant="caption" style={{ textAlign: "center" }}>
          We will never ask you for your code. Standard SMS rates apply.
        </Type>
        <AuthAside>
          <Type variant="caption">Already with us?</Type>
          <TextLink
            label="Sign in"
            strong
            onPress={() => router.replace({ pathname: "/(auth)/sign-in", params: { workspace } })}
          />
        </AuthAside>
      </AuthFoot>
    </AuthScene>
  );
}
