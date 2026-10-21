"use client";

import { useState } from "react";

import { DataTable, Feedback, PageHeader, Panel, ResourceState, Status, useResource } from "@/components/management/ManagementUI";
import { ManagementFailure, formatDate, managementFetch } from "@/lib/management";

type Report = { id: string; subject_type: string; subject_id: string; category: string; summary: string; details: string; priority: string; status: string; reported_by: string; assigned_to: string; resolution_note: string; created_at: string; evidence?: Evidence };

type EvidenceFile = { id: string; name: string; url: string };
/** What the reporter attached and what the record said when they reported (artisan reports). */
type Evidence = {
  files: EvidenceFile[];
  snapshot: {
    kind?: string;
    title?: string;
    status?: string;
    artisan?: string;
    quotes?: { price_minor: number; status: string; scope: string; reason: string; paid_at: string | null }[];
    work_reports?: { note: string; at: string; photos: string[]; receipts: string[]; reopen_reason: string }[];
  };
  snapshot_files: Record<string, EvidenceFile>;
  reported_by_side: string;
};

const SUBJECT_LABEL: Record<string, string> = { artisan: "Artisan profile", artisan_job: "Artisan job" };

function cedis(minor: number) {
  return `GH₵${(minor / 100).toLocaleString("en-GH", { minimumFractionDigits: 2 })}`;
}

function EvidenceView({ evidence }: { evidence?: Evidence }) {
  if (!evidence || (!evidence.files.length && !evidence.snapshot?.title && !evidence.snapshot?.artisan)) return null;
  const { snapshot } = evidence;
  const linked = (id: string) => evidence.snapshot_files[id];
  return (
    <div className="management-form">
      <strong>Evidence{evidence.reported_by_side ? ` · reported by the ${evidence.reported_by_side}` : ""}</strong>
      {evidence.files.length ? (
        <ul>{evidence.files.map((file) => <li key={file.id}><a href={file.url} target="_blank" rel="noreferrer">{file.name}</a></li>)}</ul>
      ) : <span className="management-subtext">No files attached.</span>}
      {snapshot.title ? <p>{snapshot.title} · {snapshot.artisan} · {snapshot.status} (as it stood when reported)</p> : snapshot.artisan ? <p>{snapshot.artisan}</p> : null}
      {snapshot.quotes?.length ? (
        <ul>{snapshot.quotes.map((quote, index) => <li key={index}>{cedis(quote.price_minor)} · {quote.status}{quote.paid_at ? " · paid" : ""}{quote.reason ? ` · ${quote.reason}` : ""}</li>)}</ul>
      ) : null}
      {snapshot.work_reports?.map((report, index) => (
        <div key={index}>
          <span className="management-subtext">Reported done {formatDate(report.at)}{report.reopen_reason ? ` · reopened: ${report.reopen_reason}` : ""}</span>
          {report.note ? <p>{report.note}</p> : null}
          <ul>{[...report.photos, ...report.receipts].map((id) => linked(id)).filter(Boolean).map((file) => <li key={file!.id}><a href={file!.url} target="_blank" rel="noreferrer">{file!.name}</a></li>)}</ul>
        </div>
      ))}
    </div>
  );
}

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

  return <><PageHeader eyebrow="Safety & conduct" title="Reports" description="Triage reported people, properties and listings. Escalate approval or moderation decisions to Operations when required." /><Feedback error={feedback.error || resource.error} success={feedback.success} /><ResourceState loading={resource.loading} error="" /><Panel title="Reported issues" meta={`${resource.data?.results.length ?? 0} shown`}><DataTable label="Reports"><thead><tr><th>Report</th><th>Subject</th><th>Priority</th><th>Status</th><th>Owner</th><th>Received</th><th>Action</th></tr></thead><tbody>{resource.data?.results.map((item) => <tr key={item.id}><td><strong>{item.summary}</strong><span className="management-subtext">{item.category}</span></td><td>{SUBJECT_LABEL[item.subject_type] ?? item.subject_type}<span className="management-subtext">{item.subject_id.slice(0, 12)}</span></td><td><Status value={item.priority} /></td><td><Status value={item.status} /></td><td>{item.assigned_to || "Unassigned"}</td><td>{formatDate(item.created_at)}</td><td><button className="management-button" onClick={() => { setSelected(item); setStatus(item.status === "open" ? "in_review" : item.status); setNote(item.resolution_note); }}>Review</button></td></tr>)}</tbody></DataTable></Panel>{selected ? <Panel title={selected.summary}><div className="management-form"><p>{selected.details || "No additional details were supplied."}</p><EvidenceView evidence={selected.evidence} /><div className="management-form-grid"><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="open">Open</option><option value="in_review">In review</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></label><label>Subject<input value={`${selected.subject_type}: ${selected.subject_id}`} disabled /></label></div><label>Resolution or triage note<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="management-form-actions"><button className="management-button primary" onClick={() => void save()}>Save report state</button><button className="management-button" onClick={() => setSelected(null)}>Cancel</button></div></div></Panel> : null}</>;
}

