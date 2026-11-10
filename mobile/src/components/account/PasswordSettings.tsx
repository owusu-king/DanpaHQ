import { useState } from "react";
import { View } from "react-native";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { fieldErrorsFrom, summaryErrorFrom, type FieldErrors } from "@/formErrors";

export function PasswordSettings() {
  const { state, refreshMe } = useAuth();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState(false);
  const [proof, setProof] = useState<{ id: string; channel: "sms" | "email" } | null>(null);
  const [code, setCode] = useState("");
  if (state.status !== "signed_in") return null;
  const me = state.me;
  const hasPassword = me.has_password ?? me.authentication_methods?.includes("phone");
  const verifiedPhone = me.is_phone_verified && me.phone_display;
  const verifiedEmail = me.is_email_verified && me.email;

  async function sendCode(channel: "sms" | "email") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ challenge_id: string }>("/me/password/create/code/", {
        method: "POST", body: { channel },
      });
      setCode("");
      setProof({ id: result.challenge_id, channel });
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not send the code.");
    } finally { setBusy(false); }
  }

  async function submit() {
    if (busy || password.length < 8 || (!hasPassword && (!proof || code.length !== 6))) return;
    setBusy(true);
    setError("");
    setFieldErrors({});
    setSaved(false);
    try {
      if (hasPassword) {
        await apiFetch("/me/password/", {
          method: "POST", body: { current_password: current, new_password: password },
        });
      } else if (proof) {
        await apiFetch("/me/password/create/", {
          method: "POST", body: { challenge_id: proof.id, code, new_password: password },
        });
        setProof(null);
        setCode("");
        await refreshMe();
      }
      setCurrent("");
      setPassword("");
      setSaved(true);
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setFieldErrors(fields);
      setError(summaryErrorFrom(cause, fields));
    } finally { setBusy(false); }
  }

  return <View style={{ gap: space[3] }}>
    <Type variant="bodyStrong">{hasPassword ? "Change password" : "Create password"}</Type>
    {hasPassword
      ? <Field label="Current password" secureTextEntry autoComplete="current-password" error={fieldErrors.current_password} value={current} onChangeText={setCurrent} />
      : <>
        <Type variant="caption">{verifiedPhone || verifiedEmail
          ? "Get a verification code at a verified contact on your account."
          : "Add and verify a phone number or email before creating a password."}</Type>
        {verifiedPhone ? <Button variant="secondary" label={proof?.channel === "sms" ? "Resend SMS code" : "Send SMS code"} disabled={busy} onPress={() => void sendCode("sms")} /> : null}
        {verifiedEmail ? <Button variant="secondary" label={proof?.channel === "email" ? "Resend email code" : "Send email code"} disabled={busy} onPress={() => void sendCode("email")} /> : null}
        {proof ? <Field label="Six-digit code" hint={(proof.channel === "sms" ? verifiedPhone : verifiedEmail) || undefined} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} error={fieldErrors.code} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, ""))} /> : null}
      </>}
    {hasPassword || proof ? <Field label="New password" secureTextEntry autoComplete="new-password" hint="Use at least 8 characters." error={fieldErrors.new_password} value={password} onChangeText={setPassword} /> : null}
    {error ? <Notice tone="error" title={error} /> : null}
    {saved ? <Notice tone="success" title="Password saved" body="Your other devices have been signed out." /> : null}
    {hasPassword || proof ? <Button label={hasPassword ? "Change password" : "Create password"} busy={busy} disabled={password.length < 8 || (hasPassword ? !current : code.length !== 6)} onPress={() => void submit()} /> : null}
  </View>;
}
