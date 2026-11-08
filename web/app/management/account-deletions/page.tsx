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
  Section,
  Status,
  Toolbar,
  managementError,
  useNotice,
  useQueryState,
  useResource,
} from "@/components/management/ManagementUI";
import { formatDate, managementFetch } from "@/lib/management";

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

const FILTERS = [
  { value: "pending", label: "Waiting" },
  { value: "completed", label: "Deleted" },
  { value: "declined", label: "Declined" },
  { value: "cancelled", label: "Withdrawn" },
  { value: "all", label: "All" },
] as const;

const STATUS_LABEL: Record<DeletionRequest["status"], string> = {
  pending: "Waiting",
  completed: "Deleted",
  declined: "Declined",
  cancelled: "Withdrawn",
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
  const notify = useNotice();
  const [filter, setFilter] = useQueryState("status", "pending");
  const resource = useResource<{ results: DeletionRequest[] }>(`/account-deletions/${filter !== "all" ? `?status=${filter}` : ""}`);
  const [selected, setSelected] = useState<DeletionRequest | null>(null);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(action: "approve" | "decline") {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await managementFetch(`/account-deletions/${selected.id}/${action}/`, { method: "POST", body: JSON.stringify({ note }) });
      notify(
        "success",
        action === "approve" ? "The account was deleted and its personal data erased." : "The request was declined and the person was told why.",
      );
      setSelected(null);
      setConfirming(false);
      await resource.reload();
    } catch (cause) {
      setError(managementError(cause, "That decision did not save."));
    } finally {
      setBusy(false);
    }
  }

  const rows = resource.data?.results ?? [];

  return (
    <>
      <PageHeader
        title="Account deletions"
      />

      <Panel title="Requests" busy={resource.refreshing} meta={resource.data ? `${rows.length} ${rows.length === 1 ? "request" : "requests"}` : undefined}>
        <Toolbar>
          <FilterTabs label="Show" value={filter} onChange={(value) => { setFilter(value); setSelected(null); }} options={FILTERS} />
        </Toolbar>
        <ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} />
        {resource.data && rows.length ? (
          <DataTable label="Account deletion requests">
            <thead><tr><th>Person</th><th>Reason</th><th>To check</th><th>Status</th><th>Requested</th><th className="is-end"><span className="sr-only">Action</span></th></tr></thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.user.display_name}</strong><span className="management-subtext">{item.user.phone || "Erased"} · joined {formatDate(item.user.joined_at)}</span></td>
                  <td>{item.reason || <span className="management-subtext">No reason given</span>}</td>
                  <td>{item.blockers.length ? <Status value="pending" tone="warning" label={`${item.blockers.length} to settle`} /> : <span className="management-subtext">Nothing flagged</span>}</td>
                  <td><Status value={item.status} label={STATUS_LABEL[item.status]} tone={item.status === "completed" ? "neutral" : undefined} /></td>
                  <td className="is-date">{formatDate(item.requested_at)}</td>
                  <td className="is-end">
                    {item.status === "pending" ? (
                      <button type="button" className="management-button primary" onClick={() => { setSelected(item); setNote(""); setConfirming(false); setError(""); }}>Review</button>
                    ) : (
                      <span className="management-subtext">{item.decided_by ? `${item.decided_by} · ` : ""}{item.decided_at ? formatDate(item.decided_at) : ""}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : resource.data ? (
          <Empty icon="trash" message={filter === "pending" ? "No one is waiting for a deletion decision." : "No requests in this view."} />
        ) : null}
      </Panel>

      {selected ? (
        <Drawer
          title={`Delete ${selected.user.display_name}?`}
          meta={`Requested ${formatDate(selected.requested_at)}`}
          onClose={() => { setSelected(null); setConfirming(false); }}
          busy={busy}
          footer={confirming ? (
            <>
              <button type="button" className="management-button danger solid" disabled={busy} onClick={() => void decide("approve")}>{busy ? "Deleting…" : "Yes, delete permanently"}</button>
              <button type="button" className="management-button" disabled={busy} onClick={() => setConfirming(false)}>Go back</button>
            </>
          ) : (
            <>
              <button type="button" className="management-button danger" onClick={() => setConfirming(true)}>Delete account</button>
              <button type="button" className="management-button" disabled={busy || !note.trim()} onClick={() => void decide("decline")}>Decline</button>
              <span className="management-spacer" />
              <button type="button" className="management-button" onClick={() => setSelected(null)}>Cancel</button>
            </>
          )}
        >
          <Facts>
            <Fact label="Phone">{selected.user.phone || "Erased"}</Fact>
            <Fact label="Joined">{formatDate(selected.user.joined_at)}</Fact>
          </Facts>
          <Section title="Their reason">
            <blockquote className="management-quote">{selected.reason || "None given."}</blockquote>
          </Section>
          <Section title="What they were told Management would check">
            {selected.blockers.length ? (
              <ul className="management-list">{selected.blockers.map((line) => <li key={line}>{line}</li>)}</ul>
            ) : <p>Nothing was flagged when they asked.</p>}
          </Section>
          <Section title="Decision">
            <div className="management-form">
              {confirming ? (
                <Feedback error="Deleting erases their name, phone number, email, photo and identity details, ends every session, and cannot be undone." />
              ) : (
                <p className="management-hint">
                  Deleting erases their name, phone number, email, photo and identity details, ends every session, and cannot be undone.
                  Agreements, payments and audit records stay, with the name removed from the account.
                </p>
              )}
              <label>
                Note
                <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Required to decline. The requester receives this reason." disabled={busy} />
              </label>
              <Feedback error={error} />
            </div>
          </Section>
        </Drawer>
      ) : null}
    </>
  );
}
