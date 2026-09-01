"use client";

import { FormEvent, useState } from "react";

import { DataTable, Feedback, PageHeader, Panel, ResourceState, Status, useResource } from "@/components/management/ManagementUI";
import { ManagementFailure, formatDate, managementFetch } from "@/lib/management";

type Case = { id: string; user: string; user_phone: string; category: string; summary: string; details: string; priority: string; status: string; assigned_to: string; resolution_note: string; related_application_id: string; related_lease_id: string; created_at: string };

export default function SupportPage() {
  const resource = useResource<{ results: Case[] }>("/support/");
  const [selected, setSelected] = useState<Case | null>(null);
  const [status, setStatus] = useState("in_review");
  const [note, setNote] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [feedback, setFeedback] = useState({ error: "", success: "" });

  async function update() {
    if (!selected) return;
    try { await managementFetch(`/support/${selected.id}/`, { method: "PATCH", body: JSON.stringify({ status, resolution_note: note }) }); setFeedback({ error: "", success: "Support case updated." }); setSelected(null); await resource.reload(); }
    catch (cause) { setFeedback({ error: cause instanceof ManagementFailure ? cause.message : "Could not update the case.", success: "" }); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = { user_id: form.get("user_id") || null, category: form.get("category"), summary: form.get("summary"), details: form.get("details"), priority: form.get("priority") };
    try { await managementFetch("/support/", { method: "POST", body: JSON.stringify(body) }); setShowNew(false); setFeedback({ error: "", success: "Support case created and assigned to you." }); await resource.reload(); }
    catch (cause) { setFeedback({ error: cause instanceof ManagementFailure ? cause.message : "Could not create this case.", success: "" }); }
  }

  return <><PageHeader eyebrow="Customer care" title="Support" description="Resolve account and rental issues with the minimum customer data needed. Critical trust decisions remain locked to Operations." actions={<button className="management-button primary" onClick={() => setShowNew((value) => !value)}>New support case</button>} /><Feedback error={feedback.error || resource.error} success={feedback.success} />{showNew ? <Panel title="Create support case"><form className="management-form" onSubmit={create}><div className="management-form-grid"><label>Consumer user ID<input name="user_id" placeholder="Optional UUID" /></label><label>Category<select name="category"><option value="account">Account access</option><option value="verification">Verification</option><option value="application">Application</option><option value="lease">Lease</option><option value="payment">Payment</option><option value="property">Property or listing</option><option value="other">Other</option></select></label><label>Priority<select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="low">Low</option></select></label><label>Summary<input name="summary" required maxLength={180} /></label></div><label>Details<textarea name="details" /></label><div className="management-form-actions"><button className="management-button primary">Create case</button><button type="button" className="management-button" onClick={() => setShowNew(false)}>Cancel</button></div></form></Panel> : null}<ResourceState loading={resource.loading} error="" /><Panel title="Support queue" meta={`${resource.data?.results.length ?? 0} cases`}><DataTable label="Support cases"><thead><tr><th>Customer</th><th>Issue</th><th>Priority</th><th>Status</th><th>Assigned</th><th>Opened</th><th>Action</th></tr></thead><tbody>{resource.data?.results.map((item) => <tr key={item.id}><td><strong>{item.user || "Not linked"}</strong><span className="management-subtext">{item.user_phone}</span></td><td><strong>{item.summary}</strong><span className="management-subtext">{item.category}</span></td><td><Status value={item.priority} /></td><td><Status value={item.status} /></td><td>{item.assigned_to || "Unassigned"}</td><td>{formatDate(item.created_at)}</td><td><button className="management-button" onClick={() => { setSelected(item); setStatus(item.status === "open" ? "in_review" : item.status); setNote(item.resolution_note); }}>Handle</button></td></tr>)}</tbody></DataTable></Panel>{selected ? <Panel title={selected.summary}><div className="management-form"><p>{selected.details || "No additional details supplied."}</p><div className="management-form-grid"><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="open">Open</option><option value="in_review">In review</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></label><label>Rental references<input value={selected.related_application_id || selected.related_lease_id || "None"} disabled /></label></div><label>Resolution note<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="management-form-actions"><button className="management-button primary" onClick={() => void update()}>Save case</button><button className="management-button" onClick={() => setSelected(null)}>Cancel</button></div></div></Panel> : null}</>;
}

