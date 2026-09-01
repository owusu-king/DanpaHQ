"use client";

import { useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { issuedNotice, privateAccess, type AccessCodeLike } from "@/lib/accessCodeMeaning";
import { ApiFailure } from "@/lib/api";
import { revokeUnitAccessCode, rotateUnitAccessCode } from "@/lib/console";

/**
 * One Unit's private share code, wherever the provider is standing.
 *
 * The code used to be reachable on the web only through the Portfolio summary,
 * which is scoped to organization membership. A provider who holds authority
 * over a Property directly — no Portfolio — manages verified Units with live
 * codes and saw an empty tab. The Unit read is scoped by `is_managed_by`
 * instead, so this component reads the code from the Unit it is about.
 *
 * Concise on purpose: what state the code is in, and the one or two things to
 * do about it. Whether the section belongs on screen at all is
 * `privateAccess`'s decision, not this component's, so both clients agree.
 *
 * The readable value exists only in this component's state after it is issued.
 * It is never reconstructed from the Unit response and never stored.
 */
export function UnitPrivateAccess({
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

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued);
      setMessage("Copied.");
    } catch {
      setMessage("Could not copy automatically — select the code to copy it.");
    }
  }

  const notice = issuedNotice(accessCode);

  return (
    <section className="unit-access" aria-labelledby={`unit-access-${unitId}`}>
      <h3 id={`unit-access-${unitId}`}>Private access</h3>

      {issued ? (
        <>
          <Notice tone="success" title={notice.title} body={notice.body} />
          <p className="unit-access-code"><code>{issued}</code></p>
        </>
      ) : (
        <p className="unit-access-state" data-tone={view.tone}>
          <strong>{view.headline}</strong>
          <span>{view.detail}</span>
        </p>
      )}

      {error ? <Notice tone="error" title={error} /> : null}
      {message ? <p className="type-caption">{message}</p> : null}

      {issued || view.primary || view.canRevoke ? (
        <div className="unit-access-actions">
          {issued ? <Button variant="secondary" onClick={() => void copy()}>Copy code</Button> : null}
          {view.primary ? (
            <Button variant="secondary" busy={busy} onClick={() => void rotate()}>{view.primary}</Button>
          ) : null}
          {view.canRevoke ? (
            <Button variant="quiet" busy={busy} onClick={() => void revoke()}>Revoke</Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
