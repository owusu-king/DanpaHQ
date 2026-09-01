"use client";

import { DataTable, PageHeader, Panel, ResourceState, Status, useResource } from "@/components/management/ManagementUI";
import { formatDate } from "@/lib/management";

type Provider = { id: string; applicant: string; phone: string; relationship: string; title: string; property_type: string; locality: string; region: string; status: string; verification_id: string; decision_note: string; submitted_at: string | null };

export default function ProvidersPage() {
  const resource = useResource<{ results: Provider[] }>("/providers/");
  return (
    <>
      <PageHeader eyebrow="Property trust" title="Property verification history" description="See each property submission and its single verification outcome. Evidence decisions are made from the verification queue." />
      <ResourceState loading={resource.loading} error={resource.error} />
      <Panel title="Property submissions" meta={`${resource.data?.results.length ?? 0} shown`}>
        <DataTable label="Property verification submissions">
          <thead><tr><th>Submitted by</th><th>Authority evidence</th><th>Property</th><th>Location</th><th>Verification</th><th>Submitted</th></tr></thead>
          <tbody>{resource.data?.results.map((item) => (
            <tr key={item.id}><td><strong>{item.applicant}</strong><span className="management-subtext">{item.phone}</span></td><td>{item.relationship.replaceAll("_", " ")}</td><td><strong>{item.title}</strong><span className="management-subtext">{item.property_type}</span></td><td>{item.locality}<span className="management-subtext">{item.region}</span></td><td><Status value={item.status} />{item.decision_note ? <span className="management-subtext">{item.decision_note}</span> : null}</td><td>{formatDate(item.submitted_at)}</td></tr>
          ))}</tbody>
        </DataTable>
      </Panel>
    </>
  );
}
