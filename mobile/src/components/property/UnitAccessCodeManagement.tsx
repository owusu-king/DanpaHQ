import { useState } from "react";
import { Share, View } from "react-native";

import { issuedNotice, privateAccess, type AccessCodeLike } from "@/accessCodeMeaning";
import { ApiFailure } from "@/api";
import { Button, Notice, Type, space } from "@/components/ui";
import { revokeUnitAccessCode, rotateUnitAccessCode } from "@/provider";
import { theme } from "@/theme";

/**
 * One Unit's private share code, wherever the provider is standing.
 *
 * Concise on purpose: what state the code is in, and the one or two things to
 * do about it. Whether the section belongs on screen at all is
 * `privateAccess`'s decision rather than this component's, so the Unit screen
 * and the Tenants tab — and the web — all agree about the same Unit.
 *
 * The readable value exists only in this component's state after it is issued.
 * It is never reconstructed from the Unit response and never stored.
 */
export function UnitAccessCodeManagement({
  unitId,
  accessCode,
  verified,
  occupied,
  onChanged,
}: {
  unitId: string;
  accessCode: AccessCodeLike;
  verified: boolean;
  occupied: boolean;
  onChanged: () => Promise<void>;
}) {
  const [issued, setIssued] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const view = privateAccess(accessCode, { verified, occupied });
  if (!view.show) return null;

  async function rotate() {
    setBusy(true);
    setError("");
    setIssued("");
    try {
      const next = await rotateUnitAccessCode(unitId);
      setIssued(next.code);
      setMessage("Any previous code stopped working immediately.");
      try {
        await onChanged();
      } catch {
        setMessage("The code was created, but its status could not refresh. Share it now.");
      }
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not create a code.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setError("");
    try {
      await revokeUnitAccessCode(unitId);
      setIssued("");
      setMessage("The code was revoked and can no longer be used.");
      try {
        await onChanged();
      } catch {
        setMessage("The code was revoked, but its status could not refresh.");
      }
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not revoke the code.");
    } finally {
      setBusy(false);
    }
  }

  const notice = issuedNotice(accessCode);

  return (
    <View style={{ gap: space[2], paddingTop: space[2] }}>
      <Type variant="title2" accessibilityRole="header">Private access</Type>

      {issued ? (
        <>
          <Notice tone="success" title={notice.title} body={notice.body} />
          <Type variant="mono" selectable>{issued}</Type>
        </>
      ) : (
        <>
          <Type
            variant="bodyStrong"
            style={view.tone === "blocked" ? { color: theme.color.ink["700"] } : undefined}
          >
            {view.headline}
          </Type>
          <Type variant="caption">{view.detail}</Type>
        </>
      )}

      {error ? <Notice tone="error" title={error} /> : null}
      {message ? <Type variant="caption">{message}</Type> : null}

      {issued ? (
        <Button
          label="Share code"
          variant="secondary"
          onPress={() => {
            void Share.share({ message: `Rooomly space access code: ${issued}` });
          }}
        />
      ) : null}
      {view.primary ? (
        <Button label={view.primary} variant="secondary" busy={busy} onPress={() => void rotate()} />
      ) : null}
      {view.canRevoke ? (
        <Button label="Revoke" variant="quiet" busy={busy} onPress={() => void revoke()} />
      ) : null}
    </View>
  );
}
