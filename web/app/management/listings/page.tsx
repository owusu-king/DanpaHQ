"use client";

import { useState } from "react";

import {
  DataTable,
  Drawer,
  Empty,
  Fact,
  Facts,
  Feedback,
  FilterTabs,
  PageHeader,
  Panel,
  ResourceState,
  SearchField,
  Status,
  Toolbar,
  countMeta,
  humanize,
  managementError,
  matches,
  useNotice,
  useQueryState,
  useResource,
} from "@/components/management/ManagementUI";
import { Radio } from "@/components/Check";
import { formatDate, managementFetch, useManagement } from "@/lib/management";

type Listing = { id: string; headline: string; status: string; rent_minor: number; rent_currency: string; provider: string; provider_phone: string; property: string; locality: string; review_note: string; created_at: string; reviewed_at: string | null };
type Action = "approve" | "reject" | "suspend" | "flag";

const ACTIONS: ReadonlyArray<{ value: Action; label: string; hint: string; danger?: boolean }> = [
  { value: "approve", label: "Approve", hint: "Publish it to public discovery." },
  { value: "flag", label: "Flag for investigation", hint: "Keep a record of the concern while it is looked into." },
  { value: "reject", label: "Reject submission", hint: "Return it to the provider with the reason.", danger: true },
  { value: "suspend", label: "Suspend listing", hint: "Take it out of discovery at once.", danger: true },
];

const CONFIRM: Record<Action, string> = {
  approve: "Approve listing",
  flag: "Flag listing",
  reject: "Reject listing",
  suspend: "Suspend listing",
};

const DONE: Record<Action, string> = {
  approve: "approved and public",
  flag: "flagged for investigation",
  reject: "rejected",
  suspend: "suspended",
};

function money(minor: number, currency: string) {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency }).format(minor / 100);
}

export default function ListingsPage() {
  const { can } = useManagement();
  const notify = useNotice();
  const resource = useResource<{ results: Listing[] }>("/listings/");
  const [query, setQuery] = useQueryState("q");
  const [status, setStatus] = useQueryState("status");
  const [selected, setSelected] = useState<Listing | null>(null);
  const [action, setAction] = useState<Action>("approve");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await managementFetch(`/listings/${selected.id}/moderate/`, { method: "POST", body: JSON.stringify({ action, note }) });
      notify("success", `${selected.headline}: ${DONE[action]}.`);
      setSelected(null);
      setNote("");
      await resource.reload();
    } catch (cause) {
      setError(managementError(cause, "Could not moderate this listing."));
    } finally {
      setBusy(false);
    }
  }

  const all = resource.data?.results ?? [];
  const statuses = [...new Set(all.map((item) => item.status))].sort((a, b) => (a === "pending_review" ? -1 : b === "pending_review" ? 1 : a.localeCompare(b)));
  const searched = all.filter((item) => matches(query, item.headline, item.provider, item.provider_phone, item.property, item.locality));
  const rows = searched.filter((item) => !status || item.status === status);
  const mayModerate = can("moderate_listings");
  const needsNote = action !== "approve";
  const current = ACTIONS.find((item) => item.value === action)!;

  return <>
    <PageHeader
      title="Listings"
      description="Move a provider’s submission into public discovery, or take a risky listing out of it. Only Operations Admins can moderate."
    />
    <Panel title="Listing inventory" meta={resource.data ? countMeta(rows.length, all.length, ["listing", "listings"]) : undefined}>
      <Toolbar>
        <SearchField label="Filter listings" placeholder="Headline, provider, property or area" value={query} onChange={setQuery} />
        {resource.data ? (
          <FilterTabs
            label="Listing status"
            value={status}
            onChange={setStatus}
            options={[{ value: "", label: "All", count: searched.length }, ...statuses.map((value) => ({ value, label: humanize(value), count: searched.filter((item) => item.status === value).length }))]}
          />
        ) : null}
      </Toolbar>
      <ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} />
      {resource.data && rows.length ? (
        <DataTable label="Listings">
          <thead><tr><th>Listing</th><th>Provider</th><th>Property</th><th>Rent</th><th>Status</th><th>Submitted</th><th className="is-end"><span className="sr-only">Action</span></th></tr></thead>
          <tbody>{rows.map((item) => (
            <tr key={item.id}>
              <td><strong>{item.headline}</strong><span className="management-subtext management-mono">{item.id.slice(0, 8)}</span></td>
              <td><strong>{item.provider}</strong><span className="management-subtext">{item.provider_phone}</span></td>
              <td>{item.property}<span className="management-subtext">{item.locality}</span></td>
              <td>{money(item.rent_minor, item.rent_currency)}</td>
              <td><Status value={item.status} />{item.review_note ? <span className="management-subtext">{item.review_note}</span> : null}</td>
              <td className="is-date">{formatDate(item.created_at)}</td>
              <td className="is-end">
                {mayModerate ? (
                  <button
                    type="button"
                    className={`management-button${item.status === "pending_review" ? " primary" : ""}`}
                    onClick={() => { setSelected(item); setAction(item.status === "pending_review" ? "approve" : "flag"); setNote(""); setError(""); }}
                  >
                    {item.status === "pending_review" ? "Review" : "Moderate"}
                  </button>
                ) : <span className="management-subtext">Read only</span>}
              </td>
            </tr>
          ))}</tbody>
        </DataTable>
      ) : resource.data ? (
        <Empty icon="listings" message={all.length ? "No listings match this filter." : "No listings have been submitted yet."} />
      ) : null}
    </Panel>

    {selected ? (
      <Drawer
        title={selected.headline}
        eyebrow="Moderate listing"
        meta={<><Status value={selected.status} /> {selected.reviewed_at ? `Last reviewed ${formatDate(selected.reviewed_at)}` : "Not reviewed yet"}</>}
        onClose={() => setSelected(null)}
        busy={busy}
        footer={<>
          <button
            type="button"
            className={`management-button ${current.danger ? "danger solid" : "primary"}`}
            disabled={busy || (needsNote && !note.trim())}
            onClick={() => void submit()}
          >
            {busy ? "Recording…" : CONFIRM[action]}
          </button>
          <button type="button" className="management-button" disabled={busy} onClick={() => setSelected(null)}>Cancel</button>
        </>}
      >
        <Facts>
          <Fact label="Provider">{selected.provider}<span className="management-subtext">{selected.provider_phone}</span></Fact>
          <Fact label="Property">{selected.property}<span className="management-subtext">{selected.locality}</span></Fact>
          <Fact label="Rent">{money(selected.rent_minor, selected.rent_currency)}</Fact>
          <Fact label="Submitted">{formatDate(selected.created_at)}</Fact>
        </Facts>
        {selected.review_note ? <blockquote className="management-quote">{selected.review_note}</blockquote> : null}
        <div className="management-form">
          <fieldset className="management-choices">
            <legend>Decision</legend>
            {ACTIONS.map((option) => (
              <div key={option.value} className={`management-choice${option.danger ? " is-danger" : ""}`}>
                <Radio name="listing-action" label={option.label} note={option.hint} checked={action === option.value} onChange={() => setAction(option.value)} disabled={busy} />
              </div>
            ))}
          </fieldset>
          <label>
            {needsNote ? "Reason" : "Internal note"}
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={needsNote ? "The reason and the next step." : "Optional note for the record."}
              disabled={busy}
            />
            <small>{needsNote ? "Required for this decision." : "Optional for an approval."}</small>
          </label>
          <Feedback error={error} />
        </div>
      </Drawer>
    ) : null}
  </>;
}
