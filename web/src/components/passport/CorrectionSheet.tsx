"use client";

import { useState } from "react";

import { Radio } from "@/components/Check";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure } from "@/lib/api";
import { requestPassportCorrection, type CorrectionRecordType, type PassportCorrection } from "@/lib/passport";

export type CorrectionTarget =
  | { kind: "identity" }
  | { kind: "tenancy"; tenancyId: string; label: string; hasPayments: boolean };

/**
 * Report a problem with a record.
 *
 * It does not edit anything. The record belongs to the agreement, the ledger
 * or the identity check it came from; a Danpa HQ reviewer compares it with
 * that source and answers in Support. Until then it is shown as disputed to
 * the tenant and to anyone they have shared it with.
 */
export function CorrectionSheet({
  target,
  onClose,
  onReported,
}: {
  target: CorrectionTarget | null;
  onClose: () => void;
  onReported: (correction: PassportCorrection) => void;
}) {
  const [shown, setShown] = useState<CorrectionTarget | null>(target);
  const [which, setWhich] = useState<CorrectionRecordType>("tenancy");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // A new target starts clean; closing keeps what was shown for the exit.
  if (target && target !== shown) {
    setShown(target);
    setWhich(target.kind === "identity" ? "identity" : "tenancy");
    setReason("");
    setError("");
  }
  const current = target ?? shown;
  if (!current) return null;
  const ready = reason.trim().length >= 10;

  async function send(close: () => void) {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      const correction = await requestPassportCorrection({
        record_type: current.kind === "identity" ? "identity" : which,
        record_id: current.kind === "identity" ? "" : current.tenancyId,
        reason: reason.trim(),
      });
      onReported(correction);
      close();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "It wasn’t sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalSheet
      open={Boolean(target)}
      onClose={onClose}
      size="sm"
      icon="warning"
      title="Report a problem"
      meta={current.kind === "identity" ? "Identity checks" : current.label}
      closeLabel="Close report"
      className="passport-correction-sheet"
      footer={(close) => (
        <>
          {error ? <span className="doc-modal-foot-note passport-foot-error" role="alert">{error}</span> : null}
          <button type="button" className="ws-action" onClick={close}>Cancel</button>
          <button type="button" className="ws-action is-primary" disabled={!ready || busy} onClick={() => void send(close)}>
            {busy ? "Sending…" : "Send for review"}
          </button>
        </>
      )}
    >
      <div className="passport-correction">
        {current.kind === "tenancy" ? (
          <fieldset className="passport-choices">
            <legend>What’s wrong?</legend>
            <Radio name="correction-record" checked={which === "tenancy"} onChange={() => setWhich("tenancy")} label="The tenancy details" note="Dates, the place, or the agreement" />
            <Radio
              name="correction-record"
              checked={which === "payments"}
              onChange={() => setWhich("payments")}
              label="The rent payments"
              note={current.hasPayments ? "A payment missing, wrong or not yours" : "A payment that should be here"}
            />
          </fieldset>
        ) : null}
        <label className="passport-field">
          <span>Tell the reviewer what to check</span>
          <textarea
            rows={4}
            maxLength={1000}
            value={reason}
            placeholder="e.g. I moved in on 3 March, not 1 March. The agreement shows the right date."
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <p className="passport-fineprint">
          A Danpa HQ reviewer checks it against the original record and replies in Support. Until then,
          this record shows as disputed here and on any link you’ve shared. Your words stay between you and Danpa HQ.
        </p>
      </div>
    </ModalSheet>
  );
}
