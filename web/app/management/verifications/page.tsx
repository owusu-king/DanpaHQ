"use client";

import { useState } from "react";

import {
  DataTable,
  Drawer,
  Empty,
  Fact,
  Facts,
  Feedback,
  PageHeader,
  Panel,
  ResourceState,
  Section,
  Status,
  humanize,
  managementError,
  useNotice,
  useResource,
} from "@/components/management/ManagementUI";
import { Icon } from "@/components/portal/icons";
import {
  formatDate,
  managementFetch,
  managementIdempotentMutation,
  useManagement,
} from "@/lib/management";

type Evidence = { id: string; evidence_type: string; filename: string; reference: string; collected_at: string };
type Verification = { id: string; kind: string; kind_label: string; status: string; method_label: string; method: string; subject_type: string; subject_label: string; subject_context: Record<string, unknown> | null; evidence: Evidence[]; created_at: string; decision_note: string };
type Queue = { id: string; priority: number; created_at: string; claimed_by_management_id: string; verification: Verification };
/** One operational decision. Property checks remain visible as evidence
 *  sections, but the package has one id and one final outcome. */
type Group = { key: string; label: string; priority: number; created_at: string; submission_id: string; items: Queue[] };

type Decision = "approve" | "reject" | "more_info";

export default function VerificationPage() {
  const { can } = useManagement();
  const notify = useNotice();
  const resource = useResource<{ results: Group[] }>("/verifications/");
  const [selected, setSelected] = useState<Group | null>(null);
  const [note, setNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState("");

  function open(group: Group) {
    setSelected(group);
    setNote("");
    setInternalNote("");
    setError("");
  }

  /** Decide a property package once, or a non-property verification once. */
  async function decide(approved: boolean) {
    if (!selected) return;
    setBusy(approved ? "approve" : "reject");
    setError("");
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
      notify("success", approved ? `${what} verified.` : `${what} rejected with a recorded reason.`);
      setSelected(null);
      await resource.reload();
    } catch (cause) {
      setError(managementError(cause, "Could not record this decision."));
    } finally {
      setBusy(null);
    }
  }

  async function moreInfo() {
    if (!selected) return;
    setBusy("more_info");
    setError("");
    try {
      const endpoint = selected.submission_id
        ? `/property-verifications/${selected.submission_id}/more-info/`
        : `/verifications/${selected.items[0]!.verification.id}/more-info/`;
      await managementFetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ note }),
        ...managementIdempotentMutation(),
      });
      notify("success", "More information requested from the applicant.");
      setSelected(null);
      await resource.reload();
    } catch (cause) {
      setError(managementError(cause, "Could not request more information."));
    } finally {
      setBusy(null);
    }
  }

  async function openEvidence(item: Queue, evidence: Evidence) {
    try {
      const response = await managementFetch<{ download_url: string }>(`/verifications/${item.verification.id}/evidence/${evidence.id}/`);
      window.open(response.download_url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(managementError(cause, "Could not open this evidence."));
    }
  }

  const rows = resource.data?.results ?? [];
  const mayDecide = can("decide_verifications");
  const noted = note.trim().length > 0;
  const first = selected?.items[0]?.verification;

  return <>
    <PageHeader
      title="Verification queue"
      description="Examine each submission and its evidence, then make one decision. A verified property has passed both the authority-document and condition-photo checks."
    />
    <Panel title="Awaiting review" meta={resource.data ? `${rows.length} ${rows.length === 1 ? "submission" : "submissions"}` : undefined}>
      <ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} />
      {resource.data && rows.length ? (
        <DataTable label="Verification review queue">
          <thead><tr><th>Subject</th><th>Checks</th><th>Evidence</th><th>Priority</th><th>Waiting since</th><th className="is-end"><span className="sr-only">Action</span></th></tr></thead>
          <tbody>{rows.map((group) => {
            const lead = group.items[0]!;
            const evidenceCount = group.items.reduce((total, item) => total + item.verification.evidence.length, 0);
            return <tr key={group.key}>
              <td><strong>{group.label || lead.verification.subject_label}</strong><span className="management-subtext">{humanize(lead.verification.subject_type)}</span></td>
              <td><div className="management-status-stack">{group.items.map((item) => <Status key={item.id} value={item.verification.status} label={item.verification.kind_label} />)}</div></td>
              <td>{evidenceCount ? `${evidenceCount} ${evidenceCount === 1 ? "file" : "files"}` : <span className="management-subtext">None attached</span>}</td>
              <td>{group.priority}</td>
              <td className="is-date">{formatDate(group.created_at)}</td>
              <td className="is-end"><button type="button" className="management-button primary" onClick={() => open(group)}>Review</button></td>
            </tr>;
          })}</tbody>
        </DataTable>
      ) : resource.data ? (
        <Empty icon="verification" title="The queue is clear" message="New submissions appear here as soon as they are sent." />
      ) : null}
    </Panel>

    {selected && first ? (
      <Drawer
        wide
        title={selected.label || first.subject_label}
        eyebrow={selected.submission_id ? "Property verification" : first.kind_label}
        meta={`Waiting since ${formatDate(selected.created_at)}`}
        onClose={() => setSelected(null)}
        busy={busy !== null}
        footer={mayDecide ? (
          <>
            <button type="button" className="management-button primary" disabled={busy !== null} onClick={() => void decide(true)}>
              {busy === "approve" ? "Recording…" : selected.submission_id ? "Verify property" : "Approve"}
            </button>
            <button type="button" className="management-button" disabled={busy !== null || !noted} onClick={() => void moreInfo()}>
              {busy === "more_info" ? "Sending…" : "Request more information"}
            </button>
            <span className="management-spacer" />
            <button type="button" className="management-button danger" disabled={busy !== null || !noted} onClick={() => void decide(false)}>
              {busy === "reject" ? "Recording…" : selected.submission_id ? "Reject property" : "Reject"}
            </button>
          </>
        ) : undefined}
      >
        {first.subject_context && Object.keys(first.subject_context).length ? (
          <Section title="Submission">
            <Facts>
              {Object.entries(first.subject_context).map(([key, value]) => (
                <Fact key={key} label={humanize(key)}>{value === null || value === "" ? "—" : String(value)}</Fact>
              ))}
            </Facts>
          </Section>
        ) : null}

        {selected.items.map((item) => (
          <Section key={item.id} title={item.verification.kind_label} aside={<Status value={item.verification.status} />}>
            {item.verification.kind === "provider" && item.verification.method === "management_approval" ? <p className="management-hint">Review this provider account and its recorded terms acceptance. Registration does not require identity documents; approval does not verify a property or a biometric identity.</p> : null}
            {item.verification.method_label ? <p className="management-hint">{item.verification.method_label}</p> : null}
            {item.verification.evidence.length ? (
              <ul className="management-file-list">
                {item.verification.evidence.map((evidence) => (
                  <li key={evidence.id}>
                    <button type="button" onClick={() => void openEvidence(item, evidence)}>
                      <Icon name={/\.(jpe?g|png|webp|heic)$/i.test(evidence.filename) ? "photos" : "leases"} />
                      <span>{evidence.filename || humanize(evidence.evidence_type)}</span>
                      <small>Opens in a new tab</small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="management-hint">Nothing attached.</p>}
          </Section>
        ))}

        {mayDecide ? (
          <Section title="Decision">
            <div className="management-form">
              <label>
                Note to the applicant
                <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What was wrong, or what they should send next." disabled={busy !== null} />
                <small>Required to reject or to ask for more information. The applicant reads it.</small>
              </label>
              <label>
                Internal review note
                <textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} placeholder="Risk signals or corroborating checks. Never copy passwords or one-time codes." disabled={busy !== null} />
                <small>Seen only by Management.</small>
              </label>
              <Feedback error={error} />
            </div>
          </Section>
        ) : (
          <>
            <p className="management-hint">Your role can read this submission. Decisions need the verification permission.</p>
            <Feedback error={error} />
          </>
        )}
      </Drawer>
    ) : null}
  </>;
}
