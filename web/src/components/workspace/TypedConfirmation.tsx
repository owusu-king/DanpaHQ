"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { ApiFailure } from "@/lib/api";
import { confirmsExactly } from "@/lib/confirmation";
import { ModalSheet } from "./ModalSheet";

export function TypedConfirmation({ open, onClose, title, description, phrase, confirmationPrompt, confirmLabel, destructive = false, reasonRequired = false, onConfirm }: {
  open: boolean; onClose: () => void; title: string; description?: string;
  phrase?: string; confirmationPrompt?: ReactNode; confirmLabel: string; destructive?: boolean; reasonRequired?: boolean;
  onConfirm: (reason: string) => Promise<void>;
}) {
  return <ModalSheet open={open} onClose={onClose} size="sm" icon={destructive ? "lock" : "home"} title={title} className={`compact-action-sheet${destructive ? " danger-confirmation" : ""}`}>
    {(close) => <ConfirmationForm {...{ description, phrase, confirmationPrompt, confirmLabel, destructive, reasonRequired, onConfirm }} close={close} />}
  </ModalSheet>;
}

function ConfirmationForm({ description, phrase, confirmationPrompt, confirmLabel, destructive, reasonRequired, onConfirm, close }: {
  description?: string; phrase?: string; confirmationPrompt?: ReactNode; confirmLabel: string; destructive: boolean; reasonRequired: boolean;
  onConfirm: (reason: string) => Promise<void>; close: () => void;
}) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = (phrase === undefined || confirmsExactly(value, phrase)) && (!reasonRequired || Boolean(reason.trim()));
  return <form className="compact-form" onSubmit={async event => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setError("");
    try { await onConfirm(reason.trim()); close(); }
    catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "That could not be completed. Please try again."); }
    finally { setBusy(false); }
  }}>
    {description ? <p className={destructive ? "danger-confirmation-warning" : "pd-note"}>{description}</p> : null}
    {phrase !== undefined ? <Field label={destructive ? <>Type <strong>{phrase}</strong> to confirm deletion</> : confirmationPrompt ?? "Confirmation"} hint={destructive || confirmationPrompt !== undefined ? undefined : phrase ? `Type ${phrase} exactly, including capital letters.` : "Name this property before deleting it."} value={value} onChange={event => setValue(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} /> : null}
    {reasonRequired ? <Field label="Reason" hint="Recorded in the audit history." value={reason} maxLength={400} onChange={event => setReason(event.target.value)} disabled={busy} /> : null}
    {error ? <Notice tone="error" title={error} /> : null}
    <div className="compact-form-actions"><Button type="button" variant="quiet" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" variant={destructive ? "destructive" : "primary"} disabled={!ready} busy={busy} busyLabel="Working…">{confirmLabel}</Button></div>
  </form>;
}
