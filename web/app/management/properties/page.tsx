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

type Property = { id: string; title: string; property_type: string; owner: string; owner_phone: string; locality: string; region: string; relationship_count: number; created_at: string };

export default function PropertiesPage() {
  const resource = useResource<{ results: Property[] }>("/properties/");
  const [query, setQuery] = useQueryState("q");
  const all = resource.data?.results ?? [];
  const rows = all.filter((item) => matches(query, item.title, item.owner, item.owner_phone, item.locality, item.region));

  return (
    <>
      <PageHeader
        title="Properties"
      />
      <Panel title="Verified properties" meta={resource.data ? countMeta(rows.length, all.length, ["property", "properties"]) : undefined}>
        <Toolbar>
          <SearchField label="Filter properties" placeholder="Property, owner, phone or area" value={query} onChange={setQuery} />
        </Toolbar>
        <ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} />
        {resource.data && rows.length ? (
          <DataTable label="Properties">
            <thead><tr><th>Property</th><th>Owner</th><th>Location</th><th>Authorised people</th><th>Created</th></tr></thead>
            <tbody>{rows.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.title}</strong><span className="management-subtext">{humanize(item.property_type)}</span></td>
                <td><strong>{item.owner}</strong><span className="management-subtext">{item.owner_phone}</span></td>
                <td>{item.locality}<span className="management-subtext">{item.region}</span></td>
                <td>{item.relationship_count}</td>
                <td className="is-date">{formatDate(item.created_at)}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        ) : resource.data ? (
          <Empty icon="properties" message={all.length ? "No properties match this search." : "No properties have been verified yet."} />
        ) : null}
      </Panel>
    </>
  );
}
