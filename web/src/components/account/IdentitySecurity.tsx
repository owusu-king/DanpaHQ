"use client";

import { useState } from "react";
import { CircleCheck } from "lucide-react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { authedFetch } from "@/lib/auth";
import { ApiFailure } from "@/lib/api";
import { getWebDeviceContext } from "@/lib/device";
import { useSession, type Me } from "@/lib/session";

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
        <strong>{state.me.phone_display}</strong>
        <span className="security-verified"><CircleCheck aria-hidden="true" />Verified</span>
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
        <p>Code sent to <strong>{phoneDisplay}</strong>.</p>
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
          <Button type="submit" size="sm" busy={busy} busyLabel="Verifying…" disabled={code.length !== 6}>Verify phone</Button>
          <Button type="button" size="sm" variant="quiet" onClick={() => { setChallengeId(""); setError(""); }}>Change number</Button>
        </div>
      </form>
    );
  }

  return (
    <form className="security-identity-form" onSubmit={sendCode}>
      <Field
        label="Mobile number"
        type="tel"
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        inputMode="tel"
        autoComplete="tel"
        placeholder="024 123 4567"
      />
      {error ? <Notice tone="error" title={error} /> : null}
      <Button type="submit" size="sm" busy={busy} busyLabel="Sending…" disabled={!phone.trim()}>Send code</Button>
    </form>
  );
}
