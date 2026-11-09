import { useState } from "react";
import { View } from "react-native";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { getGoogleCredential } from "@/googleIdentity";

export function PasswordSettings() {
  const { state, refreshMe } = useAuth();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  if (state.status !== "signed_in") return null;
  const me = state.me;
  const hasPassword = me.has_password ?? me.authentication_methods?.includes("phone");
  if (!hasPassword && !me.google_linked) return null;

  async function submit() {
    if (busy || password.length < 8) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      if (hasPassword) {
        await apiFetch("/me/password/", {
          method: "POST", body: { current_password: current, new_password: password },
        });
      } else {
        const credential = await getGoogleCredential();
        if (!credential) return;
        await apiFetch("/me/password/google/", {
          method: "POST", body: { credential, new_password: password },
        });
        await refreshMe();
      }
      setCurrent("");
      setPassword("");
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : cause instanceof Error ? cause.message : "Could not save the password.");
    } finally { setBusy(false); }
  }

  return <View style={{ gap: space[3] }}>
    <Type variant="bodyStrong">Password</Type>
    {hasPassword
      ? <Field label="Current password" secureTextEntry autoComplete="current-password" value={current} onChangeText={setCurrent} />
      : <Type variant="caption">Confirm your linked Google account to enable password sign-in.</Type>}
    <Field label="New password" secureTextEntry autoComplete="new-password" hint="Use at least 8 characters." value={password} onChangeText={setPassword} />
    {error ? <Notice tone="error" title={error} /> : null}
    {saved ? <Notice tone="success" title="Password saved" body="Your other devices have been signed out." /> : null}
    <Button label={hasPassword ? "Change password" : "Confirm with Google"} busy={busy} disabled={password.length < 8 || Boolean(hasPassword && !current)} onPress={() => void submit()} />
  </View>;
}
