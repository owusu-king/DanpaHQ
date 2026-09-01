"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Check } from "@/components/Check";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { ApiFailure } from "@/lib/api";
import { createOrganization, type Organization } from "@/lib/console";
import {
  ORGANIZATION_ACTIVITY_OPTIONS,
  toggleOrganizationActivity,
} from "@/lib/organizationSetup";
import { useSession } from "@/lib/session";

const TYPES = [
  ["individual_owner", "Individual property owner"],
  ["property_company", "Property company"],
  ["property_manager", "Professional property manager"],
  ["hostel_operator", "Student hostel operator"],
] as const;

export default function OrganizationSetupPage() {
  const router = useRouter();
  const { state, refresh, setActiveContext } = useSession();
  const [name, setName] = useState("");
  const [type, setType] = useState<Organization["organization_type"]>("property_company");
  const [activities, setActivities] = useState<Organization["activities"]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canSetUpPortfolio = state.status === "signed_in"
    && state.me.capabilities.active_workspace === "provider"
    && state.me.capabilities.provider.can_create_property;

  useEffect(() => {
    if (state.status === "signed_in" && !canSetUpPortfolio) {
      router.replace(state.me.entry_routes.web as never);
    }
  }, [canSetUpPortfolio, router, state]);

  if (!canSetUpPortfolio) {
    return (
      <main style={{ maxWidth: "42rem", margin: "0 auto", padding: "var(--space-12) var(--space-5)" }}>
        <p className="type-caption">Opening the right experience…</p>
      </main>
    );
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const organization = await createOrganization({
        name: name.trim(),
        organization_type: type,
        activities,
      });
      await refresh();
      setActiveContext(`organization:${organization.id}`);
      router.replace("/properties");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not create the Portfolio.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: "42rem", margin: "0 auto", padding: "var(--space-12) var(--space-5)", display: "grid", gap: "var(--space-5)" }}>
      <header>
        <p className="type-label">PORTFOLIO SETUP</p>
        <h1 className="type-display-2">Set up a property business</h1>
        <p className="type-body">Use this for a company, hostel operation, professional management business, or Team. Individual owners can simply create their first Property and Rooomly creates a personal Portfolio automatically.</p>
      </header>
      <Field label="Portfolio name" hint="For example: Ama Properties" value={name} onChange={(event) => setName(event.target.value)} />
      <Select label="Management type" value={type} onChange={(value) => setType(value as Organization["organization_type"])} options={TYPES} />
      <fieldset style={{ border: 0, padding: 0, display: "grid", gap: "var(--space-3)" }}>
        <legend className="type-body-strong">Property activities</legend>
        {ORGANIZATION_ACTIVITY_OPTIONS.map((option) => (
          <Check
            key={option.value}
            label={option.label}
            checked={activities.includes(option.value)}
            onChange={() => setActivities((current) => toggleOrganizationActivity(current, option.value))}
          />
        ))}
      </fieldset>
      {error ? <Notice tone="error" title={error} /> : null}
      <Button onClick={submit} busy={busy} disabled={!name.trim() || activities.length === 0}>Create Portfolio</Button>
    </main>
  );
}
