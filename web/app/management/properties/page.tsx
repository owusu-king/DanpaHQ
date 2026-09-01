"use client";

import { DataTable, PageHeader, Panel, ResourceState, useResource } from "@/components/management/ManagementUI";
import { formatDate } from "@/lib/management";

type Property = { id: string; title: string; property_type: string; owner: string; owner_phone: string; locality: string; region: string; relationship_count: number; created_at: string };

export default function PropertiesPage() {
  const resource = useResource<{ results: Property[] }>("/properties/");
  return <><PageHeader eyebrow="Physical inventory" title="Properties" description="Review the verified physical property records behind rental listings and the people authorized to manage them." /><ResourceState loading={resource.loading} error={resource.error} /><Panel title="Verified properties" meta={`${resource.data?.results.length ?? 0} shown`}><DataTable label="Properties"><thead><tr><th>Property</th><th>Owner</th><th>Location</th><th>Authority links</th><th>Created</th></tr></thead><tbody>{resource.data?.results.map((item) => <tr key={item.id}><td><strong>{item.title}</strong><span className="management-subtext">{item.property_type}</span></td><td><strong>{item.owner}</strong><span className="management-subtext">{item.owner_phone}</span></td><td>{item.locality}<span className="management-subtext">{item.region}</span></td><td>{item.relationship_count}</td><td>{formatDate(item.created_at)}</td></tr>)}</tbody></DataTable></Panel></>;
}

