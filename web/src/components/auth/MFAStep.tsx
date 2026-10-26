"use client";

import { useState } from "react";

import { Button } from "@/components/Button";
import { Check } from "@/components/Check";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { isMFAChallenge, type MFAChallenge, type MFAConfirmation } from "@/lib/mfa";

export function MFAStep<T>({ initial, request, onComplete, onCancel }: {
  initial: MFAChallenge;
  request: (body: MFAConfirmation) => Promise<T | MFAChallenge>;
  onComplete: (result: T) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [challenge, setChallenge] = useState(initial);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(action: MFAConfirmation["action"]) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await request({ challenge_token: challenge.challenge_token, code, action });
      if (isMFAChallenge(result)) { setChallenge(result); setCode(""); }
      else await onComplete(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not confirm your code.");
    } finally { setBusy(false); }
  }

  return <div className="auth-form">
    {challenge.stage === "enroll" ? <>
      <p className="auth-note">Scan with Google Authenticator, Microsoft Authenticator or another authenticator app.</p>
      {/* A data image keeps the server-generated SVG out of the document DOM. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="Authenticator setup QR code" width={208} height={208}
        style={{ alignSelf: "center", maxWidth: "100%", background: "white", borderRadius: 8 }}
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(challenge.qr_svg ?? "")}`} />
      <details className="auth-note"><summary>Enter a setup key instead</summary>
        <code style={{ display: "block", overflowWrap: "anywhere", userSelect: "all" }}>{challenge.secret}</code>
      </details>
    </> : null}
    {challenge.stage === "recovery" ? <>
      <p className="auth-note">Save these recovery codes somewhere private. Each works once if you lose your authenticator.</p>
      <div aria-label="Recovery codes" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, fontSize: 13, userSelect: "all" }}>
        {challenge.recovery_codes?.map((value) => <code key={value} style={{ overflowWrap: "anywhere" }}>{value}</code>)}
      </div>
      <Check checked={saved} onChange={setSaved} label="I saved my recovery codes" />
      <Button className="auth-submit" busy={busy} disabled={!saved} onClick={() => void submit("complete")}>Continue</Button>
    </> : <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void submit("verify"); }}>
      <Field label={challenge.stage === "enroll" ? "Authenticator code" : "Authenticator / recovery code"}
        value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code"
        autoCapitalize="none" spellCheck={false} maxLength={32}
        inputMode={challenge.stage === "enroll" ? "numeric" : "text"} required />
      <Button type="submit" className="auth-submit" busy={busy} disabled={!code.trim()}>Confirm code</Button>
      {challenge.can_skip ? <Button variant="quiet" disabled={busy} onClick={() => void submit("skip")}>Set up later</Button> : null}
    </form>}
    {error ? <Notice tone="error" title={error} /> : null}
    <Button variant="quiet" disabled={busy} onClick={onCancel}>Back to sign in</Button>
  </div>;
}
