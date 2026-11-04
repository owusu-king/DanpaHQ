"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

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
  Section,
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
import { formatDate, managementFetch } from "@/lib/management";

type Message = { id: string; body: string; mine: boolean; author_name: string; created_at: string };
type Case = {
  id: string; user: string; user_phone: string; category: string; summary: string;
  details: string; priority: string; status: string; assigned_to: string;
  related_application_id: string; related_lease_id: string; resolution_note: string;
  last_message: string; unread: boolean; created_at: string;
};
type CaseDetail = Case & { messages: Message[]; legacy_message?: string };

const CATEGORIES = [
  ["account", "Account access"],
  ["verification", "Verification"],
  ["application", "Application"],
  ["lease", "Lease"],
  ["payment", "Payment"],
  ["property", "Property or listing"],
  ["other", "Other"],
] as const;

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_review", label: "In review" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
] as const;

export default function SupportPage() {
  const notify = useNotice();
  const resource = useResource<{ results: Case[] }>("/support/");
  const [query, setQuery] = useQueryState("q");
  const [filter, setFilter] = useQueryState("status", "active");
  const [selected, setSelected] = useState<CaseDetail | null>(null);
  const [opening, setOpening] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [caseStatus, setCaseStatus] = useState("open");
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const thread = useRef<HTMLDivElement>(null);

  // The newest message is the one being answered.
  useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [selected?.messages.length, selected?.id]);

  async function open(item: Case) {
    setOpening(item.id);
    try {
      const detail = await managementFetch<CaseDetail>(`/support/${item.id}/`);
      setSelected(detail);
      setCaseStatus(detail.status === "open" ? "in_review" : detail.status);
      setNote(detail.resolution_note);
      setReply("");
      setError("");
    } catch (cause) {
      notify("error", managementError(cause, "Could not open the case."));
    } finally { setOpening(""); }
  }

  async function update() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await managementFetch(`/support/${selected.id}/`, { method: "PATCH", body: JSON.stringify({ status: caseStatus, resolution_note: note }) });
      notify("success", "Support case updated.");
      setSelected(null);
      await resource.reload();
    } catch (cause) {
      setError(managementError(cause, "Could not update the case."));
    } finally { setBusy(false); }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!selected || !reply.trim()) return;
    setBusy(true);
    setError("");
    try {
      const detail = await managementFetch<CaseDetail>(`/support/${selected.id}/messages/`, { method: "POST", body: JSON.stringify({ message: reply.trim() }) });
      setSelected(detail);
      setReply("");
      notify("success", "Reply sent.");
      await resource.reload();
    } catch (cause) {
      setError(managementError(cause, "Could not send the reply."));
    } finally { setBusy(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (!body.user_id) delete body.user_id;
    setBusy(true);
    setError("");
    try {
      await managementFetch("/support/", { method: "POST", body: JSON.stringify(body) });
      setShowNew(false);
      notify("success", "Support case created and assigned to you.");
      await resource.reload();
    } catch (cause) {
      setError(managementError(cause, "Could not create this case."));
    } finally { setBusy(false); }
  }

  const all = resource.data?.results ?? [];
  const searched = all.filter((item) => matches(query, item.user, item.user_phone, item.summary, item.last_message, item.assigned_to, item.category));
  const isActive = (item: Case) => item.status === "open" || item.status === "in_review";
  const rows = searched.filter((item) => filter === "all" || (filter === "active" ? isActive(item) : item.status === filter));
  const options = [
    { value: "active", label: "Open", count: searched.filter(isActive).length },
    { value: "resolved", label: "Resolved", count: searched.filter((item) => item.status === "resolved").length },
    { value: "dismissed", label: "Dismissed", count: searched.filter((item) => item.status === "dismissed").length },
    { value: "all", label: "All", count: searched.length },
  ];

  return <>
    <PageHeader
      title="Support"
      actions={<button type="button" className="management-button primary" onClick={() => { setShowNew(true); setError(""); }}>New case</button>}
    />
    <Panel title="Support queue" meta={resource.data ? countMeta(rows.length, all.length, ["case", "cases"]) : undefined}>
      <Toolbar>
        <SearchField label="Filter cases" placeholder="Customer, phone or issue" value={query} onChange={setQuery} />
        {resource.data ? (
          <FilterTabs label="Case status" value={filter} onChange={setFilter} options={options} />
        ) : null}
      </Toolbar>
      <ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} />
      {resource.data && rows.length ? (
        <DataTable label="Support cases">
          <thead><tr><th>Customer</th><th>Issue</th><th>Priority</th><th>Status</th><th>Assigned</th><th>Opened</th><th className="is-end"><span className="sr-only">Action</span></th></tr></thead>
          <tbody>{rows.map((item) => (
            <tr key={item.id}>
              <td><strong>{item.user || "Not linked to an account"}{item.unread ? <span className="management-new">New</span> : null}</strong><span className="management-subtext">{item.user_phone}</span></td>
              <td><strong>{item.summary}</strong><span className="management-subtext">{item.last_message || humanize(item.category)}</span></td>
              <td><Status value={item.priority} /></td>
              <td><Status value={item.status} /></td>
              <td>{item.assigned_to || <span className="management-subtext">Unassigned</span>}</td>
              <td className="is-date">{formatDate(item.created_at)}</td>
              <td className="is-end">
                <button type="button" className={`management-button${isActive(item) ? " primary" : ""}`} disabled={opening !== ""} onClick={() => void open(item)}>
                  {opening === item.id ? "Opening…" : isActive(item) ? "Handle" : "Open"}
                </button>
              </td>
            </tr>
          ))}</tbody>
        </DataTable>
      ) : resource.data ? (
        <Empty icon="support" message={all.length ? "No cases match this filter." : "No support cases yet."} />
      ) : null}
    </Panel>

    {selected ? (
      <Drawer
        wide
        title={selected.summary}
        eyebrow={humanize(selected.category)}
        meta={`${selected.user || "Not linked to an account"}${selected.user_phone ? ` · ${selected.user_phone}` : ""} · opened ${formatDate(selected.created_at)}`}
        onClose={() => setSelected(null)}
        busy={busy}
        footer={<>
          <button type="button" className="management-button primary" disabled={busy} onClick={() => void update()}>{busy ? "Saving…" : "Save case"}</button>
          <button type="button" className="management-button" disabled={busy} onClick={() => setSelected(null)}>Close</button>
        </>}
      >
        <Section title="Conversation">
          <div className="management-thread" ref={thread} aria-label="Support messages" tabIndex={0}>
            {selected.messages.length ? selected.messages.map((message) => (
              <div key={message.id} className={`management-message${message.mine ? " mine" : ""}`}>
                <p>{message.body}</p>
                <small>{message.mine ? "You" : message.author_name} · {formatDate(message.created_at)}</small>
              </div>
            )) : <p>{selected.legacy_message || selected.details || "No opening message supplied."}</p>}
          </div>
          <form className="management-form" style={{ padding: 0 }} onSubmit={sendReply}>
            <label>
              Reply to the customer
              <textarea value={reply} onChange={(event) => setReply(event.target.value)} maxLength={2000} disabled={busy} />
              <small>{reply.length ? `${reply.length} / 2000` : "They are notified when you send."}</small>
            </label>
            <div className="management-form-actions">
              <button type="submit" className="management-button" disabled={busy || !reply.trim()}>Send reply</button>
            </div>
          </form>
        </Section>
        <Section title="Case">
          <Facts columns={3}>
            <Fact label="Priority"><Status value={selected.priority} /></Fact>
            <Fact label="Assigned">{selected.assigned_to || "Unassigned"}</Fact>
            <Fact label="Rental reference" mono>{selected.related_application_id || selected.related_lease_id || "None"}</Fact>
          </Facts>
          <div className="management-form" style={{ padding: 0 }}>
            <label>
              Status
              <select value={caseStatus} onChange={(event) => setCaseStatus(event.target.value)} disabled={busy}>
                {STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              Resolution note
              <textarea value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} />
            </label>
            <Feedback error={error} />
          </div>
        </Section>
      </Drawer>
    ) : null}

    {showNew ? (
      <Drawer
        title="New support case"
        meta="The case is assigned to you."
        onClose={() => setShowNew(false)}
        busy={busy}
        footer={<>
          <button type="submit" form="new-support-case" className="management-button primary" disabled={busy}>{busy ? "Creating…" : "Create case"}</button>
          <button type="button" className="management-button" disabled={busy} onClick={() => setShowNew(false)}>Cancel</button>
        </>}
      >
        <form id="new-support-case" className="management-form" onSubmit={create}>
          <label>
            Summary <span className="sr-only">(required)</span>
            <input name="summary" required maxLength={180} disabled={busy} />
          </label>
          <div className="management-form-grid">
            <label>
              Category
              <select name="category" disabled={busy}>
                {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Priority
              <select name="priority" defaultValue="normal" disabled={busy}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
          </div>
          <label>
            Customer account ID
            <input name="user_id" placeholder="Optional" disabled={busy} className="management-mono" />
          </label>
          <label>
            Opening message
            <textarea name="details" disabled={busy} />
          </label>
          <Feedback error={error} />
        </form>
      </Drawer>
    ) : null}
  </>;
}
