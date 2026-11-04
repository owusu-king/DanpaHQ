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
import { Icon } from "@/components/portal/icons";
import { formatDate, managementFetch } from "@/lib/management";

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

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_review", label: "In review" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
] as const;

function cedis(minor: number) {
  return `GH₵${(minor / 100).toLocaleString("en-GH", { minimumFractionDigits: 2 })}`;
}

function FileList({ files }: { files: EvidenceFile[] }) {
  return (
    <ul className="management-file-list">
      {files.map((file) => (
        <li key={file.id}>
          <a href={file.url} target="_blank" rel="noreferrer">
            <Icon name="photos" />
            <span>{file.name}</span>
            <small>Opens in a new tab</small>
          </a>
        </li>
      ))}
    </ul>
  );
}

function EvidenceView({ evidence }: { evidence?: Evidence }) {
  if (!evidence || (!evidence.files.length && !evidence.snapshot?.title && !evidence.snapshot?.artisan)) return null;
  const { snapshot } = evidence;
  const linked = (id: string) => evidence.snapshot_files[id];
  return (
    <Section title="Evidence" aside={evidence.reported_by_side ? <span className="management-subtext">Reported by the {evidence.reported_by_side}</span> : undefined}>
      {evidence.files.length ? <FileList files={evidence.files} /> : <p className="management-hint">No files attached.</p>}
      {snapshot.title ? <p>{snapshot.title} · {snapshot.artisan} · {snapshot.status} <span className="management-subtext">As it stood when reported</span></p> : snapshot.artisan ? <p>{snapshot.artisan}</p> : null}
      {snapshot.quotes?.length ? (
        <ul className="management-list">{snapshot.quotes.map((quote, index) => <li key={index}>{cedis(quote.price_minor)} · {quote.status}{quote.paid_at ? " · paid" : ""}{quote.reason ? ` · ${quote.reason}` : ""}</li>)}</ul>
      ) : null}
      {snapshot.work_reports?.map((report, index) => {
        const files = [...report.photos, ...report.receipts].map((id) => linked(id)).filter((file): file is EvidenceFile => Boolean(file));
        return (
          <div key={index} className="management-form" style={{ padding: 0, gap: ".5rem" }}>
            <span className="management-subtext">Reported done {formatDate(report.at)}{report.reopen_reason ? ` · reopened: ${report.reopen_reason}` : ""}</span>
            {report.note ? <blockquote className="management-quote">{report.note}</blockquote> : null}
            {files.length ? <FileList files={files} /> : null}
          </div>
        );
      })}
    </Section>
  );
}

export default function ReportsPage() {
  const notify = useNotice();
  const resource = useResource<{ results: Report[] }>("/reports/");
  const [query, setQuery] = useQueryState("q");
  const [filter, setFilter] = useQueryState("status", "active");
  const [selected, setSelected] = useState<Report | null>(null);
  const [status, setStatus] = useState("in_review");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await managementFetch(`/reports/${selected.id}/`, { method: "PATCH", body: JSON.stringify({ status, resolution_note: note }) });
      notify("success", "Report updated and audited.");
      setSelected(null);
      setNote("");
      await resource.reload();
    } catch (cause) {
      setError(managementError(cause, "Could not update this report."));
    } finally {
      setBusy(false);
    }
  }

  const all = resource.data?.results ?? [];
  const searched = all.filter((item) => matches(query, item.summary, item.category, item.reported_by, item.assigned_to, item.subject_id));
  const isActive = (item: Report) => item.status === "open" || item.status === "in_review";
  const rows = searched.filter((item) => filter === "all" || (filter === "active" ? isActive(item) : item.status === filter));
  const options = [
    { value: "active", label: "Needs action", count: searched.filter(isActive).length },
    { value: "resolved", label: "Resolved", count: searched.filter((item) => item.status === "resolved").length },
    { value: "dismissed", label: "Dismissed", count: searched.filter((item) => item.status === "dismissed").length },
    { value: "all", label: "All", count: searched.length },
  ];

  return <>
    <PageHeader
      title="Reports"
    />
    <Panel title="Reported issues" meta={resource.data ? countMeta(rows.length, all.length, ["report", "reports"]) : undefined}>
      <Toolbar>
        <SearchField label="Filter reports" placeholder="Summary, category or person" value={query} onChange={setQuery} />
        {resource.data ? (
          <FilterTabs label="Report status" value={filter} onChange={setFilter} options={options} />
        ) : null}
      </Toolbar>
      <ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} />
      {resource.data && rows.length ? (
        <DataTable label="Reports">
          <thead><tr><th>Report</th><th>Subject</th><th>Priority</th><th>Status</th><th>Owner</th><th>Received</th><th className="is-end"><span className="sr-only">Action</span></th></tr></thead>
          <tbody>{rows.map((item) => (
            <tr key={item.id}>
              <td><strong>{item.summary}</strong><span className="management-subtext">{humanize(item.category)}</span></td>
              <td>{SUBJECT_LABEL[item.subject_type] ?? humanize(item.subject_type)}<span className="management-subtext management-mono">{item.subject_id.slice(0, 12)}</span></td>
              <td><Status value={item.priority} /></td>
              <td><Status value={item.status} /></td>
              <td>{item.assigned_to || <span className="management-subtext">Unassigned</span>}</td>
              <td className="is-date">{formatDate(item.created_at)}</td>
              <td className="is-end">
                <button
                  type="button"
                  className={`management-button${isActive(item) ? " primary" : ""}`}
                  onClick={() => { setSelected(item); setStatus(item.status === "open" ? "in_review" : item.status); setNote(item.resolution_note); setError(""); }}
                >
                  {isActive(item) ? "Review" : "Open"}
                </button>
              </td>
            </tr>
          ))}</tbody>
        </DataTable>
      ) : resource.data ? (
        <Empty icon="reports" message={all.length ? "No reports match this filter." : "Nothing has been reported."} />
      ) : null}
    </Panel>

    {selected ? (
      <Drawer
        wide
        title={selected.summary}
        eyebrow={humanize(selected.category)}
        meta={`Received ${formatDate(selected.created_at)}${selected.reported_by ? ` from ${selected.reported_by}` : ""}`}
        onClose={() => setSelected(null)}
        busy={busy}
        footer={<>
          <button type="button" className="management-button primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save report"}</button>
          <button type="button" className="management-button" disabled={busy} onClick={() => setSelected(null)}>Cancel</button>
        </>}
      >
        <Facts columns={3}>
          <Fact label="Subject">{SUBJECT_LABEL[selected.subject_type] ?? humanize(selected.subject_type)}<span className="management-subtext management-mono">{selected.subject_id}</span></Fact>
          <Fact label="Priority"><Status value={selected.priority} /></Fact>
          <Fact label="Owner">{selected.assigned_to || "Unassigned"}</Fact>
        </Facts>
        <Section title="What was reported">
          <blockquote className="management-quote">{selected.details || "No additional details were supplied."}</blockquote>
        </Section>
        <EvidenceView evidence={selected.evidence} />
        <Section title="Triage">
          <div className="management-form">
            <label>
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value)} disabled={busy}>
                {STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              Resolution or triage note
              <textarea value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} placeholder="What was checked and what happens next." />
            </label>
            <Feedback error={error} />
          </div>
        </Section>
      </Drawer>
    ) : null}
  </>;
}
