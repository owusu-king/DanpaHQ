"use client";

import { useState, type FormEvent } from "react";
import { Check, Radio } from "@/components/Check";
import { ErrorNotice } from "@/components/toast/ErrorNotice";
import { useToast } from "@/components/toast/Toaster";
import { ManagementFailure, managementFetch } from "@/lib/management";
import { Panel, ResourceState, managementError, useNotice, useResource } from "./ManagementUI";
import styles from "./plan-configuration.module.css";

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
  return typeof value.value === "number" ? value.value.toLocaleString("en-GH") : value.value ?? "Not set";
}

export function PlanConfiguration() {
  const resource = useResource<{ plans: Plan[] }>(PATH);
  return (
    <Panel busy={resource.refreshing}>
      <div className={styles.page}>
        <header className={styles.header}>
          <h2>Provider plan inclusions</h2>
          <p>Compare the published plans and update the limits and tools included in each.</p>
        </header>
        {resource.loading ? <ResourceState loading error="" /> : null}
        {resource.error ? (
          <div className={styles.recovery}>
            <ErrorNotice title="Plan inclusions didn’t load" message={resource.error} />
            <p>Saved inclusions couldn’t be refreshed.</p>
            <button type="button" className="management-button" onClick={() => void resource.reload()}>Try again</button>
          </div>
        ) : null}
        {resource.data ? <PlanForms
          key={resource.data.plans.map((plan) => `${plan.code}:${plan.revision}`).join("|")}
          initial={resource.data.plans}
          reload={resource.reload}
        /> : null}
      </div>
    </Panel>
  );
}

function PlanForms({ initial, reload }: { initial: Plan[]; reload: () => Promise<void> }) {
  const [plans, setPlans] = useState(initial);
  const [selected, setSelected] = useState(initial[0]?.code ?? "");
  const [busy, setBusy] = useState(false);
  if (!plans.length) return <p>No provider plans are available.</p>;
  const inclusions = Array.from(new Map(plans.flatMap((plan) => plan.inclusions.map((row) => [row.key, row] as const))).values());
  const limits = inclusions.filter((row) => row.editor === "increase_limit");
  const tools = inclusions.filter((row) => row.editor === "toggle");
  const other = inclusions.filter((row) => row.editor === "read_only");
  return (
    <>
      <section className={styles.section} aria-labelledby="plan-comparison">
        <h3 id="plan-comparison">Compare saved inclusions</h3>
        <Comparison plans={plans} selected={selected} label="Saved limits and tools" groups={[
          { title: "Portfolio limits", rows: limits },
          { title: "Tools", rows: tools },
        ]} />
        {other.length ? <details className={styles.catalogue}>
          <summary>Other catalogue entries ({other.length})</summary>
          <p>These entries have no plan-specific enforcement and can’t be edited here.</p>
          <Comparison plans={plans} selected={selected} label="Read-only catalogue entries" groups={[{ title: "Catalogue entries", rows: other }]} />
        </details> : null}
      </section>
      <section className={styles.section} aria-labelledby="plan-edit">
        <h3 id="plan-edit">Edit a plan</h3>
        <p>Changes apply to every Portfolio on the selected plan, including current subscribers. Prices, invoices and Portfolio overrides stay the same.</p>
        <fieldset className={styles.picker} disabled={busy}>
          <legend>Plan to edit</legend>
          <div>
            {plans.map((plan) => (
              <Radio key={plan.code} name="inclusion-plan" label={plan.name} checked={selected === plan.code}
                onChange={() => setSelected(plan.code)} />
            ))}
          </div>
        </fieldset>
        {plans.map((plan) => <div key={plan.code} hidden={selected !== plan.code}>
          <PlanEditor key={plan.revision} plan={plan} setBusy={setBusy} reload={reload} onSaved={(saved) =>
            setPlans((current) => current.map((item) => item.code === saved.code ? saved : item))
          } />
        </div>)}
      </section>
    </>
  );
}

function Comparison({ plans, selected, label, groups }: {
  plans: Plan[];
  selected: string;
  label: string;
  groups: { title: string; rows: Inclusion[] }[];
}) {
  if (groups.every((group) => !group.rows.length)) return <p>No inclusions are available for editing.</p>;
  return (
    <div className={styles.tableWrap} role="region" aria-label={label} tabIndex={0}>
      <table className={styles.table} aria-label={label}>
        <thead><tr>
          <th scope="col">Inclusion</th>
          {plans.map((plan) => <th scope="col" key={plan.code} data-selected={plan.code === selected}>{plan.name}</th>)}
        </tr></thead>
        {groups.filter((group) => group.rows.length).map((group) => (
          <tbody key={group.title}>
            <tr className={styles.group}><th colSpan={plans.length + 1} scope="rowgroup">{group.title}</th></tr>
            {group.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.name}</th>
                {plans.map((plan) => {
                  const inclusion = plan.inclusions.find((item) => item.key === row.key);
                  return <td key={plan.code} data-selected={plan.code === selected}
                    data-muted={inclusion?.value === false || !inclusion}>{inclusion ? display(inclusion) : "Not set"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
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
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [reason, setReason] = useState("");
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const limits = plan.inclusions.filter((inclusion) => inclusion.editor === "increase_limit");
  const tools = plan.inclusions.filter((inclusion) => inclusion.editor === "toggle");
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
    setFailed(false);
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
      setFailed(true);
      toast({
        tone: "error",
        title: `Couldn’t save ${plan.name} inclusions`,
        description: managementError(cause, "Please try again. Your draft is still here."),
        action: cause instanceof ManagementFailure && cause.status === 409
          ? { label: "Reload saved inclusions", onSelect: () => void reload() }
          : undefined,
      });
    } finally {
      setSaving(false);
      setBusy(false);
    }
  }

  return <form className={`management-form ${styles.editor}`} aria-label={`${plan.name} inclusions`}
    aria-busy={saving || undefined} onSubmit={(event) => void submit(event)}>
    {review ? <>
      <h4 tabIndex={-1} ref={focusReview}>Review changes to {plan.name}</h4>
      <div className={styles.tableWrap}>
        <table className={styles.table} aria-label="Changes to review">
          <thead><tr><th scope="col">Inclusion</th><th scope="col">Saved</th><th scope="col">Proposed</th></tr></thead>
          <tbody>
            {updates.map(({ inclusion, next }) => (
              <tr key={inclusion.key}><th scope="row">{inclusion.name}</th><td>{display(inclusion)}</td><td data-selected="true">{display(next)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.reviewReason}><strong>Reason for change</strong><p>{reason}</p></div>
    </> : <>
      <h4>{plan.name} inclusions</h4>
      {limits.length ? <section className={styles.editGroup} aria-label="Portfolio limits">
        <h5>Portfolio limits</h5>
        <p>Limits can only be raised here. Raising a limit won’t reactivate previously restricted records.</p>
        {limits.map((inclusion) => {
        const value = draft[inclusion.key] ?? inclusion;
        return <div key={inclusion.key} className={styles.editRow}>
          <div>
            <label htmlFor={`${plan.code}-${inclusion.key}`}>{inclusion.name}</label>
            {inclusion.description ? <p>{inclusion.description}</p> : null}
            <small id={`${plan.code}-${inclusion.key}-saved`}>Saved: {display(inclusion)}</small>
          </div>
          <div className={styles.limit}>
            {!value.unlimited ? (
              <input type="number" min={Number(inclusion.value ?? 0)} max={2_147_483_647}
                id={`${plan.code}-${inclusion.key}`} aria-describedby={`${plan.code}-${inclusion.key}-saved`}
                required value={typeof value.value === "number" ? value.value : ""}
                onChange={(event) => change(inclusion, {
                  value: event.target.value === "" ? null : Number(event.target.value), unlimited: false,
                })} />
            ) : null}
            <Check label={<><span aria-hidden="true">Unlimited</span><span className="sr-only">Unlimited {inclusion.name.toLowerCase()}</span></>} checked={value.unlimited}
              disabled={inclusion.unlimited} onChange={(unlimited) =>
                change(inclusion, { value: unlimited ? null : inclusion.value, unlimited })
              } />
          </div>
        </div>;
        })}
      </section> : null}
      {tools.length ? <section className={styles.editGroup} aria-label="Tools">
        <h5>Tools</h5>
        {tools.map((inclusion) => {
          const value = draft[inclusion.key] ?? inclusion;
          return <div className={styles.toolRow} key={inclusion.key}>
            <Check label={inclusion.name} note={inclusion.description} checked={value.value === true}
              onChange={(checked) => change(inclusion, { value: checked, unlimited: false })} />
            <small>{value.value === true ? "Included" : "Excluded"}</small>
          </div>;
        })}
      </section> : null}
      <label className={`management-field ${styles.reason}`}>
        <span>Reason for change <small>(required)</small></span>
        <textarea required maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} />
        <small>This reason is saved in the audit log.</small>
      </label>
    </>}
    <div className={styles.footer}>
      <span aria-live="polite">{updates.length ? `${updates.length} ${updates.length === 1 ? "change" : "changes"}` : "No changes yet"}</span>
      <div className="management-form-actions">
      {failed ? <button type="button" className="management-button quiet" disabled={saving} onClick={() => void reload()}>
        Reload saved inclusions
      </button> : null}
      {review ? <button type="button" className="management-button" disabled={saving} onClick={() => setReview(false)}>
        Back to editing
      </button> : null}
      <button type="submit" className="management-button primary"
        disabled={saving || invalid || !updates.length || !reason.trim()}>
        {saving ? "Saving…" : review ? "Save inclusions" : "Review changes"}
      </button>
      </div>
    </div>
  </form>;
}

function focusReview(node: HTMLHeadingElement | null) {
  node?.focus();
}
