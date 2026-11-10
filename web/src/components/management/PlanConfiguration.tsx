"use client";

import { useState, type FormEvent } from "react";
import { Check } from "@/components/Check";
import { Feedback, Panel, ResourceState, managementError, useNotice, useResource } from "./ManagementUI";
import { managementFetch } from "@/lib/management";

type Value = string | number | boolean | null;
type Inclusion = {
  key: string;
  name: string;
  description: string;
  value: Value;
  unlimited: boolean;
  editor: "toggle" | "increase_limit" | "read_only";
};
type Plan = { code: string; name: string; revision: string; inclusions: Inclusion[] };
type Draft = { value: Value; unlimited: boolean };
const PATH = "/configuration/plans/";

function display(value: Draft) {
  if (value.unlimited) return "Unlimited";
  if (typeof value.value === "boolean") return value.value ? "Included" : "Excluded";
  return value.value ?? "Not set";
}

export function PlanConfiguration() {
  const resource = useResource<{ plans: Plan[] }>(PATH);
  return <Panel>
    <h2>Provider plan inclusions</h2>
    <p className="management-subtext">
      Changes apply to all Portfolios on the selected plan, including current subscribers. Prices,
      invoices and individual Portfolio overrides stay the same.
    </p>
    <ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} />
    {resource.data ? <PlanForms
      key={resource.data.plans.map((plan) => plan.revision).join(":")}
      initial={resource.data.plans}
      reload={resource.reload}
    /> : null}
  </Panel>;
}

function PlanForms({ initial, reload }: { initial: Plan[]; reload: () => Promise<void> }) {
  const [plans, setPlans] = useState(initial);
  const [selected, setSelected] = useState(initial[0]?.code ?? "");
  const [busy, setBusy] = useState(false);
  if (!plans.length) return <p>No provider plans are available.</p>;
  return <>
    <label className="management-field">
      <span>Plan</span>
      <select value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}>
        {plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}
      </select>
    </label>
    {plans.map((plan) => <div key={plan.code} hidden={selected !== plan.code}>
      <PlanEditor key={plan.revision} plan={plan} setBusy={setBusy} reload={reload} onSaved={(saved) =>
        setPlans((current) => current.map((item) => item.code === saved.code ? saved : item))
      } />
    </div>)}
  </>;
}

function PlanEditor({
  plan, onSaved, setBusy, reload,
}: {
  plan: Plan;
  onSaved: (plan: Plan) => void;
  setBusy: (busy: boolean) => void;
  reload: () => Promise<void>;
}) {
  const notify = useNotice();
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [reason, setReason] = useState("");
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const otherInclusions = plan.inclusions.filter((inclusion) => inclusion.editor === "read_only");
  const updates = plan.inclusions.flatMap((inclusion) => {
    const next = draft[inclusion.key];
    return next && (next.value !== inclusion.value || next.unlimited !== inclusion.unlimited)
      ? [{ inclusion, next }] : [];
  });
  const invalid = updates.some(({ inclusion, next }) => inclusion.editor === "increase_limit"
    && !next.unlimited && (typeof next.value !== "number" || !Number.isInteger(next.value)
      || next.value < Number(inclusion.value ?? 0) || next.value > 2_147_483_647));

  function change(inclusion: Inclusion, next: Draft) {
    setDraft((current) => ({ ...current, [inclusion.key]: next }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || invalid || !updates.length || !reason.trim()) return;
    setError("");
    if (!review) {
      setReview(true);
      return;
    }
    setSaving(true);
    setBusy(true);
    try {
      const saved = await managementFetch<Plan>(`${PATH}${encodeURIComponent(plan.code)}/`, {
        method: "PATCH",
        body: JSON.stringify({
          revision: plan.revision,
          reason: reason.trim(),
          updates: updates.map(({ inclusion, next }) => ({ key: inclusion.key, ...next })),
        }),
      });
      notify("success", `${plan.name} plan inclusions saved.`);
      onSaved(saved);
    } catch (cause) {
      setError(managementError(cause, "Could not save the plan inclusions."));
    } finally {
      setSaving(false);
      setBusy(false);
    }
  }

  return <form className="management-form" onSubmit={(event) => void submit(event)}>
    {review ? <>
      <h3>Review changes to {plan.name}</h3>
      <ul>
        {updates.map(({ inclusion, next }) => (
          <li key={inclusion.key}>{inclusion.name}: {display(inclusion)} → {display(next)}</li>
        ))}
      </ul>
      <p>Reason: {reason}</p>
    </> : <>
      <p className="management-subtext">
        Limits can be raised here. Lowering a limit needs a separate review of existing Portfolios.
        Raising a limit does not automatically reactivate previously restricted records.
      </p>
      {plan.inclusions.filter((inclusion) => inclusion.editor !== "read_only").map((inclusion) => {
        const value = draft[inclusion.key] ?? inclusion;
        return <div key={inclusion.key} className="management-field">
          {inclusion.editor === "toggle" ? (
            <Check label={inclusion.name} note={inclusion.description} checked={value.value === true}
              onChange={(checked) => change(inclusion, { value: checked, unlimited: false })} />
          ) : <>
            <label className="management-field">
              <span>{inclusion.name}</span>
              <input type="number" min={Number(inclusion.value ?? 0)} max={2_147_483_647}
                disabled={value.unlimited} required value={typeof value.value === "number" ? value.value : ""}
                onChange={(event) => change(inclusion, {
                  value: event.target.value === "" ? null : Number(event.target.value), unlimited: false,
                })} />
            </label>
            <Check label={`Unlimited ${inclusion.name.toLowerCase()}`} checked={value.unlimited}
              disabled={inclusion.unlimited} onChange={(unlimited) =>
                change(inclusion, { value: unlimited ? null : inclusion.value, unlimited })
              } />
          </>}
        </div>;
      })}
      {otherInclusions.length ? <details>
        <summary>Other catalogue entries ({otherInclusions.length})</summary>
        <p className="management-subtext">These entries have no plan-specific enforcement and cannot be edited here.</p>
        <ul>
          {otherInclusions.map((inclusion) => (
            <li key={inclusion.key}>{inclusion.name} · Catalogue: {display(inclusion)}</li>
          ))}
        </ul>
      </details> : null}
      <label className="management-field">
        <span>Reason for changing this plan</span>
        <textarea required maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
    </>}
    <Feedback error={error} />
    {error ? <button type="button" className="management-link-button" onClick={() => void reload()}>
      Reload saved inclusions
    </button> : null}
    <div className="management-actions">
      {review ? <button type="button" className="management-button" disabled={saving} onClick={() => setReview(false)}>
        Back to editing
      </button> : null}
      <button type="submit" className="management-button primary"
        disabled={saving || invalid || !updates.length || !reason.trim()}>
        {saving ? "Saving…" : review ? "Save inclusions" : "Review changes"}
      </button>
    </div>
  </form>;
}
