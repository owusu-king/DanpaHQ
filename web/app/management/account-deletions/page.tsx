"use client";

import { useState } from "react";

import { DataTable, Feedback, PageHeader, Panel, ResourceState, Status, useResource } from "@/components/management/ManagementUI";
import { ManagementFailure, formatDate, managementFetch } from "@/lib/management";

type DeletionRequest = {
  id: string;
  status: "pending" | "completed" | "declined" | "cancelled";
  status_display: string;
  reason: string;
  blockers: string[];
  requested_at: string;
  decided_at: string | null;
  decision_note: string;
  decided_by: string;
  user: { id: string; display_name: string; phone: string; is_active: boolean; joined_at: string };
};

/**
 * Account deletion requests.
 *
 * A person asks from their Settings; the decision is made here. Approving
 * erases what identifies them and cannot be undone, so it takes a second,
 * explicit press after reading what they were shown. Declining needs a note,
 * because the person is told why.
 */
export default function AccountDeletionsPage() {
  const [filter, setFilter] = useState("pending");
  const resource = useResource<{ results: DeletionRequest[] }>(`/account-deletions/${filter ? `?status=${filter}` : ""}`);
  const [selected, setSelected] = useState<DeletionRequest | null>(null);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ error: "", success: "" });

  async function decide(action: "approve" | "decline") {
    if (!selected) return;
    setBusy(true);
    try {
      await managementFetch(`/account-deletions/${selected.id}/${action}/`, { method: "POST", body: JSON.stringify({ note }) });
      setFeedback({
        error: "",
        success: action === "approve" ? "The account was deleted and its personal data erased." : "The request was declined and the person was told why.",
      });
      setSelected(null);
      setConfirming(false);
      await resource.reload();
    } catch (cause) {
      setFeedback({ error: cause instanceof ManagementFailure ? cause.message : "That decision did not save.", success: "" });
    } finally {
      setBusy(false);
    }
  }

  const rows = resource.data?.results ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Customer care"
        title="Account deletions"
        description="People who asked for their account and data to be deleted. Check what stands in the way, then delete or decline with a reason."
        actions={
          <select className="management-select" value={filter} onChange={(event) => { setFilter(event.target.value); setSelected(null); }} aria-label="Show">
            <option value="pending">Waiting</option>
            <option value="completed">Deleted</option>
            <option value="declined">Declined</option>
            <option value="cancelled">Withdrawn</option>
            <option value="">All</option>
          </select>
        }
      />
      <Feedback error={feedback.error || resource.error} success={feedback.success} />
      <ResourceState loading={resource.loading} error="" />

      <Panel title="Requests" meta={`${rows.length} ${rows.length === 1 ? "request" : "requests"}`}>
        <DataTable label="Account deletion requests">
          <thead><tr><th>Person</th><th>Reason</th><th>To check</th><th>Status</th><th>Requested</th><th>Action</th></tr></thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.user.display_name}</strong><span className="management-subtext">{item.user.phone || "Erased"} · joined {formatDate(item.user.joined_at)}</span></td>
                <td>{item.reason || <span className="management-subtext">No reason given</span>}</td>
                <td>{item.blockers.length ? `${item.blockers.length} to settle` : "Nothing flagged"}</td>
                <td><Status value={item.status} /></td>
                <td>{formatDate(item.requested_at)}</td>
                <td>
                  {item.status === "pending" ? (
                    <button className="management-button" onClick={() => { setSelected(item); setNote(""); setConfirming(false); }}>Review</button>
                  ) : (
                    <span className="management-subtext">{item.decided_by ? `${item.decided_by} · ` : ""}{item.decided_at ? formatDate(item.decided_at) : ""}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>

      {selected ? (
        <Panel title={`Delete ${selected.user.display_name}?`} meta={`Requested ${formatDate(selected.requested_at)}`}>
          <div className="management-form">
            <p><strong>Their reason:</strong> {selected.reason || "None given."}</p>
            {selected.blockers.length ? (
              <div>
                <p><strong>What they were told Management would check:</strong></p>
                <ul>{selected.blockers.map((line) => <li key={line}>{line}</li>)}</ul>
              </div>
            ) : <p>Nothing was flagged when they asked.</p>}
            <p className="management-subtext">
              Deleting erases their name, phone number, email, photo and identity details, ends every session, and cannot be undone.
              Agreements, payments and audit records stay, with the name removed from the account.
            </p>
            <label>Note<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Required to decline: it is sent to the person." /></label>
            <div className="management-form-actions">
              {confirming ? (
                <>
                  <button className="management-button danger" disabled={busy} onClick={() => void decide("approve")}>{busy ? "Deleting…" : "Yes, delete permanently"}</button>
                  <button className="management-button" disabled={busy} onClick={() => setConfirming(false)}>Go back</button>
                </>
              ) : (
                <>
                  <button className="management-button danger" onClick={() => setConfirming(true)}>Delete account</button>
                  <button className="management-button" disabled={busy || !note.trim()} onClick={() => void decide("decline")}>Decline</button>
                  <button className="management-button" onClick={() => setSelected(null)}>Cancel</button>
                </>
              )}
            </div>
          </div>
        </Panel>
      ) : null}
    </>
  );
}
