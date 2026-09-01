"use client";

import { useState } from "react";

import { DataTable, Feedback, PageHeader, Panel, ResourceState, Status, useResource } from "@/components/management/ManagementUI";
import { ManagementFailure, formatDate, managementFetch } from "@/lib/management";

type Report = { id: string; subject_type: string; subject_id: string; category: string; summary: string; details: string; priority: string; status: string; reported_by: string; assigned_to: string; resolution_note: string; created_at: string };

export default function ReportsPage() {
  const resource = useResource<{ results: Report[] }>("/reports/");
  const [selected, setSelected] = useState<Report | null>(null);
  const [status, setStatus] = useState("in_review");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState({ error: "", success: "" });

  async function save() {
    if (!selected) return;
    try {
      await managementFetch(`/reports/${selected.id}/`, { method: "PATCH", body: JSON.stringify({ status, resolution_note: note }) });
      setFeedback({ error: "", success: "Report state updated and audited." }); setSelected(null); setNote(""); await resource.reload();
    } catch (cause) { setFeedback({ error: cause instanceof ManagementFailure ? cause.message : "Could not update this report.", success: "" }); }
  }

  return <><PageHeader eyebrow="Safety & conduct" title="Reports" description="Triage reported people, properties and listings. Escalate approval or moderation decisions to Operations when required." /><Feedback error={feedback.error || resource.error} success={feedback.success} /><ResourceState loading={resource.loading} error="" /><Panel title="Reported issues" meta={`${resource.data?.results.length ?? 0} shown`}><DataTable label="Reports"><thead><tr><th>Report</th><th>Subject</th><th>Priority</th><th>Status</th><th>Owner</th><th>Received</th><th>Action</th></tr></thead><tbody>{resource.data?.results.map((item) => <tr key={item.id}><td><strong>{item.summary}</strong><span className="management-subtext">{item.category}</span></td><td>{item.subject_type}<span className="management-subtext">{item.subject_id.slice(0, 12)}</span></td><td><Status value={item.priority} /></td><td><Status value={item.status} /></td><td>{item.assigned_to || "Unassigned"}</td><td>{formatDate(item.created_at)}</td><td><button className="management-button" onClick={() => { setSelected(item); setStatus(item.status === "open" ? "in_review" : item.status); setNote(item.resolution_note); }}>Review</button></td></tr>)}</tbody></DataTable></Panel>{selected ? <Panel title={selected.summary}><div className="management-form"><p>{selected.details || "No additional details were supplied."}</p><div className="management-form-grid"><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="open">Open</option><option value="in_review">In review</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></label><label>Subject<input value={`${selected.subject_type}: ${selected.subject_id}`} disabled /></label></div><label>Resolution or triage note<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="management-form-actions"><button className="management-button primary" onClick={() => void save()}>Save report state</button><button className="management-button" onClick={() => setSelected(null)}>Cancel</button></div></div></Panel> : null}</>;
}

