"use client";

/**
 * A tenancy's lease, opened over the page that asked for it.
 *
 * A lease is a document, and a manager reading a tenant does not need to leave
 * that tenant to read the agreement they signed. So the record opens here, in
 * a modal, with everything it carries on its own page: the terms, the money,
 * the rendered agreement and its PDF, and the provider's actions. Nothing
 * about who may do what moved — `LeaseRecord` draws the actions from
 * `lease.status`, calls `leaseAction` exactly as before, and ending a tenancy is
 * still confirmed on a second screen with a reason.
 *
 * The lease is read from the provider's granted leases, the same source its
 * own page uses, so a lease this account may not see is simply not found. A
 * list that already holds the row passes it as `initial` and it shows at once.
 */

import { useCallback, useEffect, useState } from "react";

import { LeaseRecord } from "@/components/leases/LeaseRecord";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure } from "@/lib/api";
import { listGrantedLeases, type Lease } from "@/lib/console";
import { leasePlace, leaseTenant, providerLeaseStatus, providerLeaseTone } from "@/lib/leaseMeaning";

export function LeaseModal({
  leaseId,
  initial,
  onClose,
  onChanged,
}: {
  /** The lease to show; `null` keeps the modal closed. */
  leaseId: string | null;
  /** The row, when the opener already has it. */
  initial?: Lease | null;
  onClose: () => void;
  /** After an action on the lease, so the page underneath can refresh. */
  onChanged?: () => Promise<void> | void;
}) {
  const record = useLeaseRecord(leaseId, initial, onChanged);
  const { lease, state } = record;
  return (
    <ModalSheet
      open={Boolean(leaseId)}
      onClose={onClose}
      // A pending agreement is read, not worked on, here: the small sheet.
      size={lease && isPending(lease) ? "sm" : "md"}
      icon="leases"
      closeLabel="Close lease"
      title={lease ? `Lease · ${leaseTenant(lease)}` : "Lease"}
      meta={leaseMeta(record)}
      bodyBusy={state === "loading"}
    >
      <LeaseBody record={record} />
    </ModalSheet>
  );
}

export type LeaseRecordState = ReturnType<typeof useLeaseRecord>;

/**
 * The lease behind a sheet: read from the provider's granted leases, shown at
 * once when the opener already holds the row, reloaded after an action.
 * Shared by LeaseModal and any sheet that shows the agreement as a view.
 */
export function useLeaseRecord(leaseId: string | null, initial?: Lease | null, onChanged?: () => Promise<void> | void) {
  const [lease, setLease] = useState<Lease | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    if (!leaseId) return;
    try {
      const rows = await listGrantedLeases();
      const found = rows.find((row) => row.id === leaseId) ?? null;
      setLease(found);
      setState(found ? "ready" : "missing");
      setError("");
    } catch (cause) {
      setState("error");
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not open this lease.");
    }
  }, [leaseId]);

  useEffect(() => {
    if (!leaseId) return;
    if (attempt === 0 && initial && initial.id === leaseId) {
      setLease(initial);
      setState("ready");
      return;
    }
    setLease(null);
    setState("loading");
    void load();
    // `initial` is read once per opening; a refreshed list must not reset the record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaseId, load, attempt]);

  async function changed() {
    await load();
    await onChanged?.();
  }

  return { lease, state, error, retry: () => setAttempt((value) => value + 1), changed };
}

/** Prepared or ready, and still in its tenancy request's hands. */
function isPending(lease: Lease) {
  return lease.status === "draft" || lease.status === "ready";
}

export function leaseMeta({ lease, state }: LeaseRecordState) {
  return lease ? (
    <>
      <span className={`doc-modal-status is-${isPending(lease) ? "waiting" : providerLeaseTone(lease)}`}><i aria-hidden="true" />{isPending(lease) ? "Pending" : providerLeaseStatus(lease)}</span>
      <span className="doc-modal-sep" aria-hidden="true">·</span>
      {leasePlace(lease)}
      {lease.agreement?.reference_number ? <><span className="doc-modal-sep" aria-hidden="true">·</span>{lease.agreement.reference_number}</> : null}
    </>
  ) : state === "loading" ? "Opening the agreement…" : undefined;
}

export function LeaseBody({ record }: { record: LeaseRecordState }) {
  const { lease, state, error, retry, changed } = record;
  return (
    <>
      {state === "loading" ? (
        <div className="doc-modal-skeleton" aria-hidden="true">
          <span className="ws-skeleton-block" style={{ width: "46%", height: "1rem" }} />
          <span className="ws-skeleton-block is-thin" style={{ width: "62%" }} />
          <span className="doc-modal-skeleton-grid">
            {Array.from({ length: 4 }).map((_, index) => <span key={index} className="ws-skeleton-block" style={{ height: "3.25rem" }} />)}
          </span>
          <span className="ws-skeleton-block" style={{ height: "9rem" }} />
        </div>
      ) : null}
      {state === "error" ? (
        <div className="doc-modal-state" role="alert">
          <strong>This lease didn’t open</strong>
          <span>{error}</span>
          <button type="button" className="inbox-text-button" onClick={retry}>Try again</button>
        </div>
      ) : null}
      {state === "missing" ? (
        <div className="doc-modal-state">
          <strong>Lease not found</strong>
          <span>It may belong to a Portfolio you no longer manage.</span>
        </div>
      ) : null}
      {lease && state === "ready" ? (
        <div className="doc-modal-record" key={lease.id}>
          <LeaseRecord lease={lease} onChanged={changed} />
        </div>
      ) : null}
    </>
  );
}
