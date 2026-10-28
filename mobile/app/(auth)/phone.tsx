import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";

import { apiBaseUrl, apiFetch, ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { ProviderTermsConsent, type AcceptedProviderTerms } from "@/components/auth/ProviderTermsConsent";
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
import { fieldErrorsFrom, isAccountExists, summaryErrorFrom } from "@/formErrors";
import { asOnboardingIntent, clearPendingOnboardingIntent, pendingOnboardingIntent } from "@/onboardingIntent";
import { phoneInputProps } from "@/platform";
import { clearRegistrationDraft, markAccountJustCreated, registrationDraft, returnDraftWithErrors, saveRegistrationDetails, saveRegistrationPhone, submitRegistration } from "@/registrationDraft";

/**
 * Step three: provider agreement first, then a phone number,
 * correctly, from someone who may be standing in the sun on a cracked screen.
 *
 * Decisions that matter here:
 *
 * - **One field.** The name and password were given on the step before and are
 *   held in memory (`registrationDraft`); the code screen creates the account
 *   with them once this number is proved.
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
  const { deviceFingerprint, state, signIn, refreshMe } = useAuth();
  const draft = registrationDraft();
  const accountType = draft?.accountType ?? (workspace === "provider" ? "provider" : "tenant");
  const createsHere = Boolean(draft?.ticket || draft?.googleTicket) || (state.status === "signed_in" && state.me.registration_state !== "complete");
  const [providerTerms, setProviderTerms] = useState<AcceptedProviderTerms | null>(draft?.providerTerms ?? null);
  const needsAgreement = accountType === "provider" && !providerTerms;
  const changeTerms = useCallback((value: AcceptedProviderTerms | null) => {
    setProviderTerms(value);
    const held = registrationDraft();
    if (held) saveRegistrationDetails({ ...held, providerTerms: value });
  }, []);

  const [phone, setPhone] = useState(draft?.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(draft?.errors.provider_terms ?? draft?.summary ?? "");
  const [unreachable, setUnreachable] = useState("");
  // Not an error: the number is fine, it simply already belongs to someone. The
  // server tells us this instead of sending a code, so the person finds out
  // here rather than after waiting for an SMS and typing six digits.
  const [accountExists, setAccountExists] = useState(false);

  // The details are still held, so going back finds them as they were left.
  const backToDetails = () => router.dismissTo({ pathname: "/(auth)/register", params: { workspace: accountType } });

  const digits = phone.replace(/\D/g, "");
  const looksComplete = digits.length >= 9;

  async function requestCode() {
    if (needsAgreement || busy) return;
    setBusy(true);
    setError("");
    try {
      if (createsHere) {
        const details = registrationDraft();
        if (!details) { backToDetails(); return; }
        const { session } = await submitRegistration({ details, ticket: details.ticket, googleTicket: details.googleTicket, deviceFingerprint });
        markAccountJustCreated(details.accountType);
        clearRegistrationDraft();
        await clearPendingOnboardingIntent();
        if (session) await signIn(session);
        else await refreshMe();
        return;
      }
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
      if (createsHere) {
        const fields = fieldErrorsFrom(cause);
        const held = registrationDraft();
        if (held) {
          if (fields.provider_terms) changeTerms(null);
          returnDraftWithErrors(held.ticket, fields, summaryErrorFrom(cause, fields));
        }
        setError(fields.provider_terms ?? summaryErrorFrom(cause, fields));
        if (!fields.provider_terms) router.replace({ pathname: "/(auth)/register", params: { workspace: accountType } });
        return;
      }
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
      progress={{ step: 3, of: draft?.googleTicket ? 3 : 4 }}
      header={<AuthBack label="Back to your details" onPress={backToDetails} />}
    >
      <AuthHeading
        title={needsAgreement ? "Provider agreement" : createsHere ? "Complete your account" : "Confirm your number"}
        line={needsAgreement ? "Review and accept the agreement before continuing." : createsHere ? "Your provider agreement is accepted. You can now finish creating your account." : "We'll text you a six-digit code."}
      />

      {needsAgreement ? <>
        <ProviderTermsConsent value={providerTerms} onChange={changeTerms} presentation="inline" />
        {error ? <Notice tone="error" title={error} /> : null}
      </> : <>
      {accountType === "provider" ? <><Type variant="caption">Provider agreement accepted.</Type><TextLink label="Review agreement" onPress={() => changeTerms(null)} /></> : null}
      {!createsHere ? <>
      <AuthFields>
        <AuthField
          labelAsPlaceholder
          label="Mobile number"
          icon="call-outline"
          prefix={DIAL_CODE}
          placeholder="Mobile number"
          value={phone}
          onChangeText={(value) => {
            setPhone(value);
            saveRegistrationPhone(value);
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
      </> : error ? <Notice tone="error" title={error} /> : null}

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
            onPress={() => {
              // The details were for a new account; this number already has one.
              clearRegistrationDraft();
              router.replace({
                pathname: "/(auth)/sign-in",
                params: { phone, workspace },
              });
            }}
          />
        </>
      ) : (
        <AuthAction
          label={createsHere ? "Create account" : "Send code"}
          busyLabel={createsHere ? "Creating your account…" : "Sending…"}
          onPress={requestCode}
          busy={busy}
          disabled={!createsHere && !looksComplete}
        />
      )}

      </>}
      {!needsAgreement && !createsHere ? <AuthFoot>
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
      </AuthFoot> : null}
    </AuthScene>
  );
}
