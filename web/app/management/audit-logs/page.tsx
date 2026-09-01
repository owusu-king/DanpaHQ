"use client";

import { DataTable, PageHeader, Panel, ResourceState, Status, useResource } from "@/components/management/ManagementUI";
import { formatDate } from "@/lib/management";

type Audit = { id: string; action: string; aggregate_type: string; aggregate_id: string; actor_label: string; actor_role: string; changes: Record<string, unknown>; metadata: Record<string, unknown>; request_id: string; ip_address: string | null; source: string; created_at: string; entry_hash: string };

export default function AuditLogsPage() {
  const resource = useResource<{ results: Audit[] }>("/audit-logs/");
  return <><PageHeader eyebrow="Accountability" title="Operational audit logs" description="Sensitive Management actions are append-only and chained per aggregate. Use request IDs to correlate an entry with server logs." /><ResourceState loading={resource.loading} error={resource.error} /><Panel title="Most recent entries" meta={`${resource.data?.results.length ?? 0} shown`}><DataTable label="Operational audit logs"><thead><tr><th>When</th><th>Action</th><th>Aggregate</th><th>Actor</th><th>Source</th><th>Trace</th></tr></thead><tbody>{resource.data?.results.map((item) => <tr key={item.id}><td>{formatDate(item.created_at)}</td><td><Status value={item.action} /></td><td><strong>{item.aggregate_type}</strong><span className="management-subtext">{item.aggregate_id.slice(0, 18)}</span></td><td><strong>{item.actor_label || "System"}</strong><span className="management-subtext">{item.actor_role || "system"}</span></td><td>{item.source}</td><td><span className="management-subtext">Request {item.request_id || "—"}<br />Hash {item.entry_hash.slice(0, 12)}…</span></td></tr>)}</tbody></DataTable></Panel></>;
}

