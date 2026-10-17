"use client";

import { FormEvent, useState } from "react";

import { DataTable, Feedback, PageHeader, Panel, ResourceState, Status, useResource } from "@/components/management/ManagementUI";
import { ManagementFailure, formatDate, managementFetch } from "@/lib/management";

type Message = { id: string; body: string; mine: boolean; author_name: string; created_at: string };
type Case = {
  id: string; user: string; user_phone: string; category: string; summary: string;
  details: string; priority: string; status: string; assigned_to: string;
  related_application_id: string; related_lease_id: string; resolution_note: string;
  last_message: string; unread: boolean; created_at: string;
};
type CaseDetail = Case & { messages: Message[]; legacy_message?: string };

export default function SupportPage() {
  const resource = useResource<{ results: Case[] }>("/support/");
  const [selected, setSelected] = useState<CaseDetail | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [caseStatus, setCaseStatus] = useState("open");
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ error: "", success: "" });

  async function open(item: Case) {
    setBusy(true);
    try {
      const detail = await managementFetch<CaseDetail>(`/support/${item.id}/`);
      setSelected(detail);
      setCaseStatus(detail.status === "open" ? "in_review" : detail.status);
      setNote(detail.resolution_note);
      setFeedback({ error: "", success: "" });
    } catch (cause) {
      setFeedback({ error: cause instanceof ManagementFailure ? cause.message : "Could not open the case.", success: "" });
    } finally { setBusy(false); }
  }

  async function update() {
    if (!selected) return;
    setBusy(true);
    try {
      await managementFetch(`/support/${selected.id}/`, { method: "PATCH", body: JSON.stringify({ status: caseStatus, resolution_note: note }) });
      setFeedback({ error: "", success: "Support case updated." });
      setSelected(null);
      await resource.reload();
    } catch (cause) {
      setFeedback({ error: cause instanceof ManagementFailure ? cause.message : "Could not update the case.", success: "" });
    } finally { setBusy(false); }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!selected || !reply.trim()) return;
    setBusy(true);
    try {
      const detail = await managementFetch<CaseDetail>(`/support/${selected.id}/messages/`, { method: "POST", body: JSON.stringify({ message: reply.trim() }) });
      setSelected(detail);
      setReply("");
      setFeedback({ error: "", success: "Reply sent." });
      await resource.reload();
    } catch (cause) {
      setFeedback({ error: cause instanceof ManagementFailure ? cause.message : "Could not send the reply.", success: "" });
    } finally { setBusy(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (!body.user_id) delete body.user_id;
    setBusy(true);
    try {
      await managementFetch("/support/", { method: "POST", body: JSON.stringify(body) });
      setShowNew(false);
      setFeedback({ error: "", success: "Support case created and assigned to you." });
      await resource.reload();
    } catch (cause) {
      setFeedback({ error: cause instanceof ManagementFailure ? cause.message : "Could not create this case.", success: "" });
    } finally { setBusy(false); }
  }

  return <>
    <PageHeader eyebrow="Customer care" title="Support" description="Read and answer customer tickets here. Property buyer and seller enquiries remain private to those participants." actions={<button className="management-button primary" onClick={() => setShowNew((value) => !value)}>New support case</button>} />
    <Feedback error={feedback.error || resource.error} success={feedback.success} />
    {showNew ? <Panel title="Create support case"><form className="management-form" onSubmit={create}><div className="management-form-grid"><label>Consumer user ID<input name="user_id" placeholder="Optional UUID" /></label><label>Category<select name="category"><option value="account">Account access</option><option value="verification">Verification</option><option value="application">Application</option><option value="lease">Lease</option><option value="payment">Payment</option><option value="property">Property or listing</option><option value="other">Other</option></select></label><label>Priority<select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="low">Low</option></select></label><label>Summary<input name="summary" required maxLength={180} /></label></div><label>Opening message<textarea name="details" /></label><div className="management-form-actions"><button className="management-button primary" disabled={busy}>Create case</button><button type="button" className="management-button" onClick={() => setShowNew(false)}>Cancel</button></div></form></Panel> : null}
    <ResourceState loading={resource.loading} error="" />
    <Panel title="Support queue" meta={`${resource.data?.results.length ?? 0} cases`}><DataTable label="Support cases"><thead><tr><th>Customer</th><th>Issue</th><th>Priority</th><th>Status</th><th>Assigned</th><th>Opened</th><th>Action</th></tr></thead><tbody>{resource.data?.results.map((item) => <tr key={item.id}><td><strong>{item.user || "Not linked"}{item.unread ? " · New" : ""}</strong><span className="management-subtext">{item.user_phone}</span></td><td><strong>{item.summary}</strong><span className="management-subtext">{item.last_message || item.category}</span></td><td><Status value={item.priority} /></td><td><Status value={item.status} /></td><td>{item.assigned_to || "Unassigned"}</td><td>{formatDate(item.created_at)}</td><td><button className="management-button" disabled={busy} onClick={() => void open(item)}>Handle</button></td></tr>)}</tbody></DataTable></Panel>
    {selected ? <Panel title={selected.summary} meta={selected.user || "Unlinked case"}><div className="management-case-workspace"><div className="management-thread" aria-label="Support messages">{selected.messages.length ? selected.messages.map((message) => <div key={message.id} className={`management-message${message.mine ? " mine" : ""}`}><p>{message.body}</p><small>{message.mine ? "You" : message.author_name} · {formatDate(message.created_at)}</small></div>) : <p>{selected.legacy_message || selected.details || "No opening message supplied."}</p>}</div><form className="management-reply" onSubmit={sendReply}><label>Reply to customer<textarea value={reply} onChange={(event) => setReply(event.target.value)} maxLength={2000} /></label><button className="management-button primary" disabled={busy || !reply.trim()}>Send reply</button></form><div className="management-form-grid"><label>Status<select value={caseStatus} onChange={(event) => setCaseStatus(event.target.value)}><option value="open">Open</option><option value="in_review">In review</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></label><label>Rental references<input value={selected.related_application_id || selected.related_lease_id || "None"} disabled /></label></div><label>Resolution note<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="management-form-actions"><button className="management-button primary" disabled={busy} onClick={() => void update()}>Save case</button><button className="management-button" onClick={() => setSelected(null)}>Close</button></div></div></Panel> : null}
  </>;
}
