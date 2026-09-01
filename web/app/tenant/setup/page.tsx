"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
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

export default function TenantSetupPage() {
  const router = useRouter();
  const [accessCode, setAccessCode] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [unitId, setUnitId] = useState("");
  const [bedId, setBedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedUnit = lookup?.units.find((unit) => unit.id === unitId) ?? null;

  async function findSpace() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await authedFetch<Lookup>(
        `/property-join-lookup/?code=${encodeURIComponent(accessCode.trim())}`,
      );
      setLookup(result);
      setUnitId(result.units[0]?.id ?? "");
      setBedId("");
    } catch (cause) {
      setLookup(null);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not find the space.");
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest() {
    if (!lookup || !unitId) return;
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
      setSuccess("Tenancy request sent. The provider must approve it before preparing your lease offer.");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not send the tenancy request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: "46rem", margin: "0 auto", padding: "var(--space-12) var(--space-5)", display: "grid", gap: "var(--space-6)" }}>
      <header>
        <p className="type-label">YOUR HOMES</p>
        <h1 className="type-display-2">Add a home</h1>
        <p className="type-body">Enter the access code shared by the provider. It identifies one verified private Unit and lets you send a tenancy request.</p>
      </header>

      <section style={{ display: "grid", gap: "var(--space-3)", padding: "var(--space-5)", border: "var(--border-hairline) solid var(--color-field-200)" }}>
        <h2 className="type-title-2">I have a Unit access code</h2>
        <p className="type-caption" style={{ margin: 0 }}>A code never creates a tenancy by itself. Request approval, review the provider’s lease offer, then accept it to activate the tenancy.</p>
        <Field
          label="Unit access code"
          value={accessCode}
          onChange={(event) => {
            setAccessCode(event.target.value);
            setLookup(null);
            setUnitId("");
            setBedId("");
          }}
        />
        <div><Button variant="secondary" onClick={findSpace} busy={busy} disabled={!accessCode.trim()}>Find Unit</Button></div>

        {lookup ? (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <p className="type-body-strong" style={{ margin: 0 }}>{lookup.title} · {lookup.locality}</p>
            {lookup.units.map((unit) => (
              <Button key={unit.id} variant="secondary" onClick={() => { setUnitId(unit.id); setBedId(""); }}>
                {unitId === unit.id ? "✓ " : ""}{unit.label}
              </Button>
            ))}
            {selectedUnit?.beds.length ? (
              <div style={{ display: "grid", gap: "var(--space-2)" }}>
                <p className="type-caption" style={{ margin: 0 }}>Choose the hostel bed you are requesting.</p>
                {selectedUnit.beds.map((bed) => (
                  <Button key={bed.id} variant="secondary" onClick={() => setBedId(bed.id)}>
                    {bedId === bed.id ? "✓ " : ""}{bed.label}
                  </Button>
                ))}
              </div>
            ) : null}
            <Button onClick={submitRequest} busy={busy} disabled={!unitId || Boolean(selectedUnit?.beds.length && !bedId)}>Send tenancy request</Button>
          </div>
        ) : null}
      </section>

      {error ? <Notice tone="error" title={error} /> : null}
      {success ? <Notice tone="success" title="Tenancy request sent" body={success} /> : null}
      <div><Button variant="quiet" onClick={() => router.replace("/home")}>Back to Home</Button></div>
    </main>
  );
}
