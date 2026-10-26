import { useEffect, useState } from "react";
import { View } from "react-native";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { AuthField, AuthFields } from "@/components/auth/AuthScene";
import { Panel } from "@/components/billing/BillingSurfaces";
import { GroupLabel } from "@/components/portfolio/PortfolioList";
import { Button, Notice, Type, space } from "@/components/ui";
import { fieldErrorsFrom } from "@/formErrors";
import { otpInputProps, phoneInputProps } from "@/platform";

/** Phone verification uses the same live-session endpoints as web. */
export function SignInMethods() {
  const { state, refreshMe, deviceFingerprint } = useAuth();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<{ id: string; phone: string } | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);
  if (state.status !== "signed_in") return null;
  const me = state.me;

  async function send() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await apiFetch<{ challenge_id: string; phone_display: string; resend_in: number }>("/me/phone/", {
        method: "POST", body: { phone: phone.trim(), device_fingerprint: deviceFingerprint },
      });
      setChallenge({ id: result.challenge_id, phone: result.phone_display });
      setCode(""); setResendIn(result.resend_in);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function verify() {
    if (busy || !challenge) return;
    setBusy(true); setError("");
    try {
      await apiFetch("/me/phone/verify/", { method: "POST", body: { challenge_id: challenge.id, code } });
      await refreshMe(); setChallenge(null); setCode("");
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  return <View style={{ gap: space[2] }}>
    <GroupLabel>Phone verification</GroupLabel>
    <Panel>
      <View style={{ padding: space[4], gap: space[3] }}>
        {me.is_phone_verified ? <Type variant="caption">{me.phone_display} · Phone verified</Type> : <>
          <Type variant="bodyStrong">Add a phone number</Type>
          {challenge ? <>
            <Type variant="caption">Code sent to {challenge.phone}</Type>
            <AuthFields><AuthField label="Verification code" icon="key-outline" value={code} onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6} {...otpInputProps} /></AuthFields>
            <Button label="Verify phone" busy={busy} disabled={code.length !== 6} onPress={() => void verify()} />
            <Button label={resendIn ? `Resend in ${resendIn}s` : "Resend code"} variant="quiet" disabled={busy || resendIn > 0} onPress={() => void send()} />
            <Button label="Use another number" variant="quiet" disabled={busy} onPress={() => { setChallenge(null); setCode(""); setError(""); }} />
          </> : <>
            <AuthFields><AuthField label="Mobile number" icon="call-outline" placeholder="024 123 4567" value={phone} onChangeText={setPhone} {...phoneInputProps} /></AuthFields>
            <Button label="Send code" busy={busy} disabled={!phone.trim()} onPress={() => void send()} />
          </>}
        </>}
        {error ? <Notice tone="error" title={error} /> : null}
      </View>
    </Panel>
  </View>;
}

function message(cause: unknown): string {
  return Object.values(fieldErrorsFrom(cause))[0]
    ?? (cause instanceof ApiFailure ? cause.error.message : "Could not update your sign-in methods. Try again.");
}
