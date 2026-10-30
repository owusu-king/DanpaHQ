"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure } from "@/lib/api";
import { getProperty, submitPropertyForVerification, type Property } from "@/lib/console";

export function PropertyVerificationModal({ propertyId, onClose, onSubmitted }: { propertyId: string | null; onClose: () => void; onSubmitted?: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <ModalSheet open={Boolean(propertyId)} onClose={() => { if (!busy) onClose(); }} icon="verification" title="Submit for verification?" size="sm" className="compact-action-sheet">
    {propertyId ? <Confirmation key={propertyId} id={propertyId} busy={busy} setBusy={setBusy} onClose={onClose} onSubmitted={onSubmitted} /> : null}
  </ModalSheet>;
}

function Confirmation({ id, busy, setBusy, onClose, onSubmitted }: { id: string; busy: boolean; setBusy: (value: boolean) => void; onClose: () => void; onSubmitted?: () => Promise<void> }) {
  const [property, setProperty] = useState<Property | null>(null);
  const [error, setError] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    if (!id) return;
    let active = true;
    getProperty(id).then((value) => { if (active) setProperty(value); }).catch(() => { if (active) setError("Could not load submission availability. Close and try again."); });
    return () => { active = false; };
  }, [id]);
  const submit = property?.permitted_actions.submit_for_verification;
  return <div className="compact-form">
    <p className="type-body">Send the property details, documents and photos to our team for review? The property stays private.</p>
    {error ? <Notice tone="error" title={error} /> : null}
    {property && !submit?.allowed ? <Notice tone="info" title="Submission unavailable" body={submit?.message} /> : null}
    <div className="compact-form-actions">
      <Button variant="quiet" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button busy={busy} disabled={!submit?.allowed} onClick={async () => {
        if (pending.current || !submit?.allowed) return;
        pending.current = true; setBusy(true); setError("");
        try { await submitPropertyForVerification(id); await onSubmitted?.(); onClose(); }
        catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not send this for verification."); }
        finally { pending.current = false; setBusy(false); }
      }}>Confirm Submission</Button>
    </div>
  </div>;
}

export function PropertySubmissionButton({ propertyId, onSubmitted, label = "Submit for verification", secondary = false }: { propertyId: string; onSubmitted?: () => Promise<void>; label?: string; secondary?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><Button variant={secondary ? "secondary" : "primary"} onClick={() => setOpen(true)}>{label}</Button><PropertyVerificationModal propertyId={open ? propertyId : null} onClose={() => setOpen(false)} onSubmitted={onSubmitted} /></>;
}
