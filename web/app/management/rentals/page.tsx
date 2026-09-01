"use client";

import { DataTable, PageHeader, Panel, ResourceState, Status, useResource } from "@/components/management/ManagementUI";
import { formatDate } from "@/lib/management";

type Application = { id: string; tenant: string; listing: string; property: string; status: string; move_in_from: string | null; created_at: string };
type Lease = { id: string; tenant: string; landlord: string; property: string; status: string; starts_on: string; ends_on: string | null; created_at: string };

export default function RentalsPage() {
  const resource = useResource<{ applications: Application[]; leases: Lease[] }>("/rentals/");
  return <><PageHeader eyebrow="Rental operations" title="Applications & leases" description="Inspect the rental context needed to answer customer issues. This workspace is read-only for Support Admins." /><ResourceState loading={resource.loading} error={resource.error} /><Panel title="Recent applications" meta={`${resource.data?.applications.length ?? 0} shown`}><DataTable label="Rental applications"><thead><tr><th>Applicant</th><th>Listing</th><th>Property</th><th>Status</th><th>Move-in</th><th>Submitted</th></tr></thead><tbody>{resource.data?.applications.map((item) => <tr key={item.id}><td><strong>{item.tenant}</strong><span className="management-subtext">{item.id.slice(0, 12)}</span></td><td>{item.listing}</td><td>{item.property}</td><td><Status value={item.status} /></td><td>{item.move_in_from || "—"}</td><td>{formatDate(item.created_at)}</td></tr>)}</tbody></DataTable></Panel><Panel title="Recent leases" meta={`${resource.data?.leases.length ?? 0} shown`}><DataTable label="Leases"><thead><tr><th>Tenant</th><th>Landlord</th><th>Property</th><th>Status</th><th>Term</th><th>Created</th></tr></thead><tbody>{resource.data?.leases.map((item) => <tr key={item.id}><td>{item.tenant}</td><td>{item.landlord}</td><td>{item.property}</td><td><Status value={item.status} /></td><td>{item.starts_on} → {item.ends_on || "Open"}</td><td>{formatDate(item.created_at)}</td></tr>)}</tbody></DataTable></Panel></>;
}

