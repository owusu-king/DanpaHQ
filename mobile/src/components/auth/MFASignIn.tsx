import { useState } from "react";
import { Linking, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { apiFetch } from "@/api";
import { AuthAction, AuthBack, AuthField, AuthFields, AuthHeading, AuthScene } from "@/components/auth/AuthScene";
import { Button, Notice, Type, space } from "@/components/ui";
import { isMFAChallenge, type MFAChallenge } from "@/mfa";
import type { CreatedSession } from "@/registrationDraft";

export function MFASignIn({ initial, onComplete, onCancel }: {
  initial: MFAChallenge;
  onComplete: (session: CreatedSession) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [challenge, setChallenge] = useState(initial);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(action: "verify" | "skip" | "complete") {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await apiFetch<CreatedSession | MFAChallenge>("/auth/mfa/", {
        method: "POST", anonymous: true, body: { challenge_token: challenge.challenge_token, code, action },
      });
      if (isMFAChallenge(result)) { setChallenge(result); setCode(""); }
      else await onComplete(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not confirm your code."); }
    finally { setBusy(false); }
  }

  return <AuthScene header={<AuthBack label="Back to sign in" onPress={onCancel} />}>
    <AuthHeading title={challenge.stage === "recovery" ? "Save your recovery codes" : challenge.stage === "enroll" ? "Set up two-factor authentication" : "Two-factor authentication"}
      line={challenge.stage === "enroll" ? "Scan with your authenticator app, or add the setup key." : challenge.stage === "verify" ? "Enter an authenticator or recovery code." : "Keep these private. Each code can be used once."} />
    {challenge.stage === "enroll" ? <>
      <View style={{ alignSelf: "center", backgroundColor: "white", padding: 16, borderRadius: 12 }}>
        <QRCode value={challenge.provisioning_uri} size={192} />
      </View>
      <Type variant="caption" selectable style={{ textAlign: "center" }}>{challenge.secret}</Type>
      <Button label="Open authenticator app" variant="quiet" onPress={() => {
        if (challenge.provisioning_uri) void Linking.openURL(challenge.provisioning_uri).catch(() => setError("Open your authenticator app and enter the setup key above."));
      }} />
    </> : null}
    {challenge.stage === "recovery" ? <>
      <View style={{ gap: space[2], alignItems: "center" }}>
        {challenge.recovery_codes?.map((value) => <Type key={value} variant="bodyStrong" selectable>{value}</Type>)}
      </View>
      <Button label={saved ? "Recovery codes saved ✓" : "I saved my recovery codes"} variant="quiet" onPress={() => setSaved((value) => !value)} />
      <AuthAction label="Continue" busy={busy} disabled={!saved} onPress={() => void submit("complete")} />
    </> : <>
      <AuthFields compact><AuthField compact hideLabel label="Authenticator code" placeholder={challenge.stage === "enroll" ? "6-digit code" : "Authenticator / recovery code"}
        icon="key-outline" value={code} onChangeText={setCode} maxLength={32}
        autoComplete="one-time-code" autoCapitalize="none" autoCorrect={false}
        keyboardType={challenge.stage === "enroll" ? "number-pad" : "default"} />
      </AuthFields>
      <AuthAction label="Confirm code" busy={busy} disabled={!code.trim()} onPress={() => void submit("verify")} />
      {challenge.can_skip ? <Button label="Set up later" variant="quiet" disabled={busy} onPress={() => void submit("skip")} /> : null}
    </>}
    {error ? <Notice tone="error" title={error} /> : null}
  </AuthScene>;
}
