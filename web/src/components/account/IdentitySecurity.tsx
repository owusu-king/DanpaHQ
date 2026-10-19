"use client";

import { useState } from "react";

import { GoogleIdentityButton } from "@/components/auth/GoogleIdentityButton";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { authedFetch } from "@/lib/auth";
import { ApiFailure } from "@/lib/api";
import { getWebDeviceContext } from "@/lib/device";
import { useSession, type Me } from "@/lib/session";

export function GoogleLinkSection() {
  const { state, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (state.status !== "signed_in") return null;

  if (state.me.google_linked) {
    return <p className="security-identity-state"><strong>Google is linked.</strong> You can use it to sign in to this same account.</p>;
  }

  return (
    <div className="security-identity-form">
      <p>Linking requires this signed-in session and a fresh Google credential. It never merges accounts by email.</p>
      <GoogleIdentityButton
        text="continue_with"
        busy={busy}
        onCredential={async (credential) => {
          setBusy(true);
          setError("");
          setMessage("");
          try {
            await authedFetch<Me>("/me/google/", {
              method: "POST",
              body: JSON.stringify({ credential }),
            });
            await refresh();
            setMessage("Google is now linked to this account.");
          } catch (cause) {
            setError(cause instanceof ApiFailure ? cause.error.message : "Could not link Google.");
          } finally {
            setBusy(false);
          }
        }}
      />
      {message ? <Notice tone="success" title={message} /> : null}
      {error ? <Notice tone="error" title={error} /> : null}
    </div>
  );
}

export function PhoneVerificationSection() {
  const { state, refresh } = useSession();
  const [phone, setPhone] = useState("");
  const [phoneDisplay, setPhoneDisplay] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (state.status !== "signed_in") return null;

  if (state.me.is_phone_verified) {
    return (
      <p className="security-identity-state">
        <strong>{state.me.phone_display}</strong> is verified for phone-sensitive actions and alerts.
      </p>
    );
  }

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await authedFetch<{ challenge_id: string; phone_display: string }>(
        "/me/phone/",
        {
          method: "POST",
          body: JSON.stringify({ phone: phone.trim(), ...getWebDeviceContext() }),
        },
      );
      setChallengeId(result.challenge_id);
      setPhoneDisplay(result.phone_display);
      setCode("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await authedFetch<Me>("/me/phone/verify/", {
        method: "POST",
        body: JSON.stringify({ challenge_id: challengeId, code }),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That code did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (challengeId) {
    return (
      <form className="security-identity-form" onSubmit={verifyCode}>
        <p>We sent six digits to <strong>{phoneDisplay}</strong>.</p>
        <Field
          label="Six-digit code"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
        />
        {error ? <Notice tone="error" title={error} /> : null}
        <div className="settings-actions">
          <Button type="submit" busy={busy} busyLabel="Verifying…" disabled={code.length !== 6}>Verify phone</Button>
          <Button type="button" variant="quiet" onClick={() => { setChallengeId(""); setError(""); }}>Change number</Button>
        </div>
      </form>
    );
  }

  return (
    <form className="security-identity-form" onSubmit={sendCode}>
      <p>Add a number now for provider verification, viewing check-in, sensitive confirmations, and SMS alerts.</p>
      <Field
        label="Mobile number"
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        inputMode="tel"
        autoComplete="tel"
        placeholder="024 123 4567"
      />
      {error ? <Notice tone="error" title={error} /> : null}
      <Button type="submit" busy={busy} busyLabel="Sending…" disabled={!phone.trim()}>Send verification code</Button>
    </form>
  );
}
