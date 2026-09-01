"use client";

import { useState } from "react";

import { DataTable, Feedback, PageHeader, Panel, ResourceState, Status, useResource } from "@/components/management/ManagementUI";
import { ManagementFailure, formatDate, managementFetch, useManagement } from "@/lib/management";

type Listing = { id: string; headline: string; status: string; rent_minor: number; rent_currency: string; provider: string; provider_phone: string; property: string; locality: string; review_note: string; created_at: string; reviewed_at: string | null };
type Action = "approve" | "reject" | "suspend" | "flag";

function money(minor: number, currency: string) {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency }).format(minor / 100);
}

export default function ListingsPage() {
  const { can } = useManagement();
  const resource = useResource<{ results: Listing[] }>("/listings/");
  const [selected, setSelected] = useState<Listing | null>(null);
  const [action, setAction] = useState<Action>("approve");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState({ error: "", success: "" });

  async function submit() {
    if (!selected) return;
    setFeedback({ error: "", success: "" });
    try {
      await managementFetch(`/listings/${selected.id}/moderate/`, { method: "POST", body: JSON.stringify({ action, note }) });
      setFeedback({ error: "", success: `Listing ${action} action recorded.` });
      setSelected(null);
      setNote("");
      await resource.reload();
    } catch (cause) {
      setFeedback({ error: cause instanceof ManagementFailure ? cause.message : "Could not moderate this listing.", success: "" });
    }
  }

  return <>
    <PageHeader eyebrow="Marketplace integrity" title="Properties & listings" description="Only Operations Admins can move a provider submission into public discovery or remove a risky listing." />
    <Feedback error={feedback.error || resource.error} success={feedback.success} />
    <ResourceState loading={resource.loading} error="" />
    <Panel title="Listing inventory" meta={`${resource.data?.results.length ?? 0} shown`}>
      <DataTable label="Listings"><thead><tr><th>Listing</th><th>Provider</th><th>Property</th><th>Rent</th><th>Status</th><th>Submitted</th><th>Action</th></tr></thead>
        <tbody>{resource.data?.results.map((item) => <tr key={item.id}><td><strong>{item.headline}</strong><span className="management-subtext">{item.id.slice(0, 12)}</span></td><td><strong>{item.provider}</strong><span className="management-subtext">{item.provider_phone}</span></td><td>{item.property}<span className="management-subtext">{item.locality}</span></td><td>{money(item.rent_minor, item.rent_currency)}</td><td><Status value={item.status} />{item.review_note ? <span className="management-subtext">{item.review_note}</span> : null}</td><td>{formatDate(item.created_at)}</td><td>{can("moderate_listings") ? <button className="management-button" onClick={() => { setSelected(item); setAction(item.status === "pending_review" ? "approve" : "flag"); setNote(""); }}>Review</button> : <span className="management-subtext">Read only</span>}</td></tr>)}</tbody>
      </DataTable>
    </Panel>
    {selected ? <Panel title={`Moderate: ${selected.headline}`}>
      <div className="management-form">
        <div className="management-form-grid"><label>Action<select value={action} onChange={(event) => setAction(event.target.value as Action)}><option value="approve">Approve for public discovery</option><option value="reject">Reject submission</option><option value="flag">Flag for investigation</option><option value="suspend">Suspend listing</option></select></label><label>Current state<input value={selected.status.replaceAll("_", " ")} disabled /></label></div>
        <label>Decision note<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={action === "approve" ? "Optional internal approval note" : "Required reason and next step"} /></label>
        <div className="management-form-actions"><button className={`management-button ${action === "approve" ? "primary" : "danger"}`} onClick={() => void submit()}>Confirm {action}</button><button className="management-button" onClick={() => setSelected(null)}>Cancel</button></div>
      </div>
    </Panel> : null}
  </>;
}

