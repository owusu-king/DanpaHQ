"use client";

import { useState } from "react";

import { DataTable, Feedback, PageHeader, Panel, ResourceState, Status, useResource } from "@/components/management/ManagementUI";
import {
  ManagementFailure,
  formatDate,
  managementFetch,
  managementIdempotentMutation,
} from "@/lib/management";

type Evidence = { id: string; evidence_type: string; filename: string; reference: string; collected_at: string };
type Verification = { id: string; kind: string; kind_label: string; status: string; method_label: string; subject_type: string; subject_label: string; subject_context: Record<string, unknown> | null; evidence: Evidence[]; created_at: string; decision_note: string };
type Queue = { id: string; priority: number; created_at: string; claimed_by_management_id: string; verification: Verification };
/** One operational decision. Property checks remain visible as evidence
 *  sections, but the package has one id and one final outcome. */
type Group = { key: string; label: string; priority: number; created_at: string; submission_id: string; items: Queue[] };

export default function VerificationPage() {
  const resource = useResource<{ results: Group[] }>("/verifications/");
  const [selected, setSelected] = useState<Group | null>(null);
  const [note, setNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [feedback, setFeedback] = useState({ error: "", success: "" });

  /** Decide a property package once, or a non-property verification once. */
  async function decide(approved: boolean) {
    if (!selected) return;
    setFeedback({ error: "", success: "" });
    try {
      const endpoint = selected.submission_id
        ? `/property-verifications/${selected.submission_id}/decision/`
        : `/verifications/${selected.items[0]!.verification.id}/decision/`;
      await managementFetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ approved, note, internal_note: internalNote }),
        ...managementIdempotentMutation(),
      });
      const what = selected.submission_id ? "Property" : "Verification";
      setFeedback({ error: "", success: approved ? `${what} verified.` : `${what} rejected with a recorded reason.` });
      setSelected(null);
      setNote("");
      setInternalNote("");
      await resource.reload();
    } catch (cause) {
      setFeedback({ error: cause instanceof ManagementFailure ? cause.message : "Could not record this decision.", success: "" });
    }
  }

  async function moreInfo() {
    if (!selected) return;
    try {
      const endpoint = selected.submission_id
        ? `/property-verifications/${selected.submission_id}/more-info/`
        : `/verifications/${selected.items[0]!.verification.id}/more-info/`;
      await managementFetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ note }),
        ...managementIdempotentMutation(),
      });
      setFeedback({ error: "", success: "More information requested from the applicant." });
      setSelected(null);
      await resource.reload();
    } catch (cause) {
      setFeedback({ error: cause instanceof ManagementFailure ? cause.message : "Could not request more information.", success: "" });
    }
  }

  async function openEvidence(item: Queue, evidence: Evidence) {
    try {
      const response = await managementFetch<{ download_url: string }>(`/verifications/${item.verification.id}/evidence/${evidence.id}/`);
      window.open(response.download_url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setFeedback({ error: cause instanceof ManagementFailure ? cause.message : "Could not open this evidence.", success: "" });
    }
  }

  return <>
    <PageHeader eyebrow="Trust review" title="Verification queue" description="Examine the submission and its evidence before making one final decision. A verified property has passed both authority-document and condition-photo checks." />
    <Feedback error={feedback.error || resource.error} success={feedback.success} />
    <ResourceState loading={resource.loading} error="" />
    <Panel title="Awaiting human review" meta={`${resource.data?.results.length ?? 0} items`}>
      <DataTable label="Verification review queue"><thead><tr><th>Priority</th><th>Subject</th><th>Checks</th><th>Evidence</th><th>Waiting since</th><th>Action</th></tr></thead><tbody>{resource.data?.results.map((group) => {
        const first = group.items[0]!;
        const evidenceCount = group.items.reduce((total, item) => total + item.verification.evidence.length, 0);
        return <tr key={group.key}>
          <td>{group.priority}</td>
          <td><strong>{group.label || first.verification.subject_label}</strong><span className="management-subtext">{first.verification.subject_type.replaceAll("_", " ")}</span></td>
          <td>{group.items.map((item) => <div key={item.id}><strong>{item.verification.kind_label}</strong> <Status value={item.verification.status} /></div>)}</td>
          <td>{evidenceCount}</td>
          <td>{formatDate(group.created_at)}</td>
          <td><button className="management-button" onClick={() => { setSelected(group); setNote(""); setInternalNote(""); }}>Review evidence</button></td>
        </tr>;
      })}</tbody></DataTable>
    </Panel>
    {selected ? <Panel title={selected.label || selected.items[0]!.verification.subject_label} meta={selected.submission_id ? "One property verification package" : selected.items[0]!.verification.kind_label}>
      <div className="management-form">
        {selected.items[0]!.verification.subject_context ? <div className="management-form-grid">{Object.entries(selected.items[0]!.verification.subject_context ?? {}).map(([key, value]) => <label key={key}>{key.replaceAll("_", " ")}<input value={String(value ?? "")} disabled /></label>)}</div> : null}

        {selected.items.map((item) => <div key={item.id}>
          <strong>{item.verification.kind_label}</strong>
          <span className="management-subtext">{item.verification.subject_label}</span>
          <div className="management-actions" style={{ marginTop: ".5rem" }}>
            {item.verification.evidence.length
              ? item.verification.evidence.map((evidence) => <button className="management-button" key={evidence.id} onClick={() => void openEvidence(item, evidence)}>{evidence.filename || evidence.evidence_type.replaceAll("_", " ")}</button>)
              : <span className="management-subtext">Nothing attached.</span>}
          </div>
        </div>)}

        <label>Applicant-facing decision note<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Required for rejection or a request for more information." /></label>
        <label>Internal review note<textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} placeholder="Record risk signals or corroborating checks. Never copy passwords or OTPs." /></label>
        <div className="management-form-actions">
          <button className="management-button primary" onClick={() => void decide(true)}>{selected.submission_id ? "Verify property" : "Approve"}</button>
          <button className="management-button danger" onClick={() => void decide(false)}>{selected.submission_id ? "Reject property" : "Reject"}</button>
          <button className="management-button" onClick={() => void moreInfo()}>Request more information</button>
          <button className="management-button" onClick={() => setSelected(null)}>Cancel</button>
        </div>
      </div>
    </Panel> : null}
  </>;
}

