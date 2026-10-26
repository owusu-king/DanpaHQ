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

type Provider = { id: string; applicant: string; phone: string; relationship: string; title: string; property_type: string; locality: string; region: string; status: string; verification_id: string; decision_note: string; submitted_at: string | null };

export default function ProvidersPage() {
  const { can } = useManagement();
  const resource = useResource<{ results: Provider[] }>("/providers/");
  const [query, setQuery] = useQueryState("q");
  const [status, setStatus] = useQueryState("status");
  const all = resource.data?.results ?? [];
  const searched = all.filter((item) => matches(query, item.applicant, item.phone, item.title, item.locality, item.region));
  const rows = searched.filter((item) => !status || item.status === status);
  const statuses = [...new Set(all.map((item) => item.status))].sort();

  return (
    <>
      <PageHeader
        title="Verification history"
        description="Each property a landlord or agent submitted, and its one verification outcome. Decisions are made in the verification queue."
        actions={can("view_verifications") ? <Link className="management-button" href="/management/verifications">Open the queue</Link> : null}
      />
      <Panel title="Property submissions" meta={resource.data ? countMeta(rows.length, all.length, ["submission", "submissions"]) : undefined}>
        <Toolbar>
          <SearchField label="Filter submissions" placeholder="Person, phone, property or area" value={query} onChange={setQuery} />
          {resource.data ? (
            <FilterTabs
              label="Verification outcome"
              value={status}
              onChange={setStatus}
              options={[{ value: "", label: "All", count: searched.length }, ...statuses.map((value) => ({ value, label: humanize(value), count: searched.filter((item) => item.status === value).length }))]}
            />
          ) : null}
        </Toolbar>
        <ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} />
        {resource.data && rows.length ? (
          <DataTable label="Property verification submissions">
            <thead><tr><th>Submitted by</th><th>Authority</th><th>Property</th><th>Location</th><th>Outcome</th><th>Submitted</th></tr></thead>
            <tbody>{rows.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.applicant}</strong><span className="management-subtext">{item.phone}</span></td>
                <td>{humanize(item.relationship)}</td>
                <td><strong>{item.title}</strong><span className="management-subtext">{humanize(item.property_type)}</span></td>
                <td>{item.locality}<span className="management-subtext">{item.region}</span></td>
                <td><Status value={item.status} />{item.decision_note ? <span className="management-subtext">{item.decision_note}</span> : null}</td>
                <td className="is-date">{formatDate(item.submitted_at)}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        ) : resource.data ? (
          <Empty icon="verification" message={all.length ? "No submissions match this filter." : "No properties have been submitted for verification yet."} />
        ) : null}
      </Panel>
    </>
  );
}
