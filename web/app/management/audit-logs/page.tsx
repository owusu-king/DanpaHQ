"use client";

import {
  DataTable,
  Empty,
  PageHeader,
  Panel,
  ResourceState,
  SearchField,
  Toolbar,
  countMeta,
  humanize,
  matches,
  useQueryState,
  useResource,
} from "@/components/management/ManagementUI";
import { formatDate } from "@/lib/management";

type Audit = { id: string; action: string; aggregate_type: string; aggregate_id: string; actor_label: string; actor_role: string; changes: Record<string, unknown>; metadata: Record<string, unknown>; request_id: string; ip_address: string | null; source: string; created_at: string; entry_hash: string };

export default function AuditLogsPage() {
  const resource = useResource<{ results: Audit[] }>("/audit-logs/");
  const [query, setQuery] = useQueryState("q");
  const all = resource.data?.results ?? [];
  const rows = all.filter((item) => matches(query, item.action, item.aggregate_type, item.aggregate_id, item.actor_label, item.request_id, item.source));

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Sensitive Management actions, append-only and chained per record. Use a request ID to find an entry in the server logs."
      />
      <Panel title="Most recent entries" meta={resource.data ? countMeta(rows.length, all.length, ["entry", "entries"]) : undefined}>
        <Toolbar>
          <SearchField label="Filter entries" placeholder="Action, record, person or request ID" value={query} onChange={setQuery} />
        </Toolbar>
        <ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} />
        {resource.data && rows.length ? (
          <DataTable label="Operational audit logs">
            <thead><tr><th>When</th><th>Action</th><th>Record</th><th>By</th><th>Source</th><th>Trace</th></tr></thead>
            <tbody>{rows.map((item) => (
              <tr key={item.id}>
                <td className="is-date">{formatDate(item.created_at)}</td>
                <td><strong className="management-mono">{item.action}</strong></td>
                <td>{humanize(item.aggregate_type)}<span className="management-subtext management-mono">{item.aggregate_id.slice(0, 18)}</span></td>
                <td><strong>{item.actor_label || "System"}</strong><span className="management-subtext">{humanize(item.actor_role || "system")}</span></td>
                <td>{humanize(item.source)}</td>
                <td><span className="management-subtext management-mono">Request {item.request_id || "—"}<br />Hash {item.entry_hash.slice(0, 12)}…</span></td>
              </tr>
            ))}</tbody>
          </DataTable>
        ) : resource.data ? (
          <Empty icon="audit" message={all.length ? "No entries match this search." : "Nothing has been recorded yet."} />
        ) : null}
      </Panel>
    </>
  );
}
