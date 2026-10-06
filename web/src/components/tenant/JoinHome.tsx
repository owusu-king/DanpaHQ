"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure, idempotentMutation } from "@/lib/api";
import { authedFetch } from "@/lib/auth";

type LookupUnit = {
  id: string;
  label: string;
  beds: Array<{ id: string; label: string }>;
};

type Lookup = {
  id: string;
  title: string;
  locality: string;
  units: LookupUnit[];
};

/**
 * "Join a home" from the tenant's Home: a small modal (owner, 2026-10-05), not
 * a page. The same form also stands on `/tenant/setup` for a direct link.
 */
export function JoinHomeButton({ className, children }: { className: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      <ModalSheet
        open={open}
        onClose={() => setOpen(false)}
        icon="home"
        title="Join a home"
        meta="Use the code from your landlord."
        size="sm"
      >
        {(close) => <JoinHomeForm onDone={close} />}
      </ModalSheet>
    </>
  );
}

/**
 * I have a Unit access code: find the space it opens, choose the Unit (and the
 * bed, in a hostel), and send a tenancy request. A code never creates a tenancy
 * by itself — the provider approves, then offers a lease to accept.
 */
export function JoinHomeForm({ onDone }: { onDone?: () => void }) {
  const [accessCode, setAccessCode] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [unitId, setUnitId] = useState("");
  const [bedId, setBedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const selectedUnit = lookup?.units.find((unit) => unit.id === unitId) ?? null;
  const needsBed = Boolean(selectedUnit?.beds.length);

  async function findSpace() {
    if (!accessCode.trim()) {
      setError("Enter the access code your landlord gave you.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await authedFetch<Lookup>(
        `/property-join-lookup/?code=${encodeURIComponent(accessCode.trim())}`,
      );
      setLookup(result);
      setUnitId(result.units.length === 1 ? result.units[0]!.id : "");
      setBedId("");
    } catch (cause) {
      setLookup(null);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not check that code: try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest() {
    if (!lookup) return;
    if (!unitId) {
      setError("Choose your Unit.");
      return;
    }
    if (needsBed && !bedId) {
      setError("Choose your bed.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await authedFetch(`/properties/${lookup.id}/join-requests/`, {
        method: "POST",
        body: JSON.stringify({
          unit_id: unitId,
          bed_id: bedId || undefined,
          access_code: accessCode.trim(),
        }),
        ...idempotentMutation(),
      });
      setSent(true);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not send the request: try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div style={STACK}>
        <Notice
          tone="success"
          title="Request sent"
          body={`${lookup?.title ?? "The provider"} will review it, then send you an agreement to accept.`}
        />
        {onDone ? (
          <div>
            <Button onClick={onDone}>Done</Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div style={STACK} aria-label="I have a Unit access code">
      <form
        style={STACK}
        onSubmit={(event) => {
          event.preventDefault();
          void (lookup ? submitRequest() : findSpace());
        }}
      >
        <Field
          label="Access code"
          placeholder="e.g. 7KQ-4M2"
          value={accessCode}
          autoFocus
          autoComplete="off"
          onChange={(event) => {
            setAccessCode(event.target.value);
            setLookup(null);
            setUnitId("");
            setBedId("");
            setError("");
          }}
        />

        {lookup ? (
          <>
            <p className="type-body-strong" style={{ margin: 0 }}>
              {lookup.title}
              <span className="type-caption" style={{ fontWeight: 400 }}> · {lookup.locality}</span>
            </p>
            {lookup.units.length > 1 ? (
              <Select
                label="Your Unit"
                value={unitId}
                onChange={(next) => {
                  setUnitId(next);
                  setBedId("");
                  setError("");
                }}
                options={[["", "Choose one"] as const, ...lookup.units.map((unit) => [unit.id, unit.label] as const)]}
              />
            ) : (
              <p className="type-caption" style={{ margin: 0 }}>Unit: {selectedUnit?.label}</p>
            )}
            {needsBed && selectedUnit ? (
              <Select
                label="Your bed"
                value={bedId}
                onChange={(next) => {
                  setBedId(next);
                  setError("");
                }}
                options={[["", "Choose one"] as const, ...selectedUnit.beds.map((bed) => [bed.id, bed.label] as const)]}
              />
            ) : null}
          </>
        ) : null}

        {error ? <Notice tone="error" title={error} /> : null}

        <div>
          <Button type="submit" busy={busy} busyLabel={lookup ? "Sending…" : "Checking…"}>
            {lookup ? "Send request" : "Find my home"}
          </Button>
        </div>
      </form>
    </div>
  );
}

const STACK: React.CSSProperties = { display: "grid", gap: "var(--space-4)" };
