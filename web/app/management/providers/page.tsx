"use client";

import Link from "next/link";

import {
  DataTable,
  Empty,
  FilterTabs,
  PageHeader,
  Panel,
  ResourceState,
  SearchField,
  Status,
  Toolbar,
  countMeta,
  humanize,
  matches,
  useQueryState,
  useResource,
} from "@/components/management/ManagementUI";
import { formatDate, useManagement } from "@/lib/management";

type VerificationRecord = { review_label: string; relationship_label: string; status_label: string; status_scope: "latest_property_submission" | "unit_review" | "provider_passport_review"; person_label: string; reviewed_at: string | null; recorded_at: string; subject_type: "property" | "unit" | "provider_passport"; id: string; applicant: string; phone: string; relationship: string; title: string; property_type: string; locality: string; region: string; status: string; verification_id: string; decision_note: string; submitted_at: string | null };

export default function ProvidersPage() {
  const { can } = useManagement();
  const resource = useResource<{ results: VerificationRecord[]; limit: number; has_more: boolean }>("/providers/");
  const [query, setQuery] = useQueryState("q");
  const [status, setStatus] = useQueryState("status");
  const all = resource.data?.results ?? [];
  const searched = all.filter((item) => matches(query, item.applicant, item.phone, item.title, item.locality, item.region, item.review_label, item.relationship_label));
  const rows = searched.filter((item) => !status || item.status === status);
  const statuses = [...new Set(all.map((item) => item.status))].sort();

  return (
    <>
      <PageHeader
        title="Verification records"
        actions={can("view_verifications") ? <Link className="management-button" href="/management/verifications">Open the queue</Link> : null}
      />
      <Panel title="Verification records" meta={resource.data ? countMeta(rows.length, all.length, ["record", "records"]) : undefined}>
        {resource.data?.has_more ? <p className="management-subtext">Showing the latest {resource.data.limit} records. Search and filters apply to these displayed records.</p> : null}
        <Toolbar>
          <SearchField label="Filter records" placeholder="Person, property, unit, role or area" value={query} onChange={setQuery} />
          {resource.data ? (
            <FilterTabs
              label="Verification status"
              value={status}
              onChange={setStatus}
              options={[{ value: "", label: "All", count: searched.length }, ...statuses.map((value) => ({ value, label: all.find((item) => item.status === value)?.status_label || humanize(value), count: searched.filter((item) => item.status === value).length }))]}
            />
          ) : null}
        </Toolbar>
        <ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} />
        {resource.data && rows.length ? (
          <DataTable label="Provider, property and unit verification records">
            <thead><tr><th>Person</th><th>Review type</th><th>Claimed role</th><th>Subject</th><th>Location</th><th>Status</th><th>Last activity</th></tr></thead>
            <tbody>{rows.map((item) => (
              <tr key={`${item.subject_type}:${item.id}`}>
                <td><strong>{item.applicant}</strong><span className="management-subtext">{item.person_label}{item.phone ? ` · ${item.phone}` : ""}</span></td>
                <td>{item.review_label}</td>
                <td>{item.subject_type === "unit" ? <span className="management-subtext">Not applicable</span> : item.relationship_label || "—"}</td>
                <td><strong>{item.title}</strong><span className="management-subtext">{humanize(item.property_type)}</span></td>
                <td>{item.locality}<span className="management-subtext">{item.region}</span></td>
                <td><Status value={item.status} label={item.status_label} /><span className="management-subtext">{item.status_scope === "unit_review" ? "Unit review record" : item.status_scope === "provider_passport_review" ? "Provider Passport review" : "Current property submission"}</span>{item.decision_note ? <span className="management-subtext">{item.decision_note}</span> : null}</td>
                <td className="is-date">{formatDate(item.recorded_at)}{item.submitted_at ? <span className="management-subtext">Submitted {formatDate(item.submitted_at)}</span> : null}{item.reviewed_at ? <span className="management-subtext">Decided {formatDate(item.reviewed_at)}</span> : null}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        ) : resource.data ? (
          <Empty icon="verification" message={all.length ? "No records match this filter." : "No provider, property or unit reviews have been recorded yet."} />
        ) : null}
      </Panel>
    </>
  );
}
