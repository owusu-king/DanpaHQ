"use client";

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
  formatDay,
  matches,
  useQueryState,
  useResource,
} from "@/components/management/ManagementUI";
import { formatDate } from "@/lib/management";

type Application = { id: string; tenant: string; listing: string; property: string; status: string; move_in_from: string | null; created_at: string };
type Lease = { id: string; tenant: string; landlord: string; property: string; status: string; starts_on: string; ends_on: string | null; created_at: string };

export default function RentalsPage() {
  const resource = useResource<{ applications: Application[]; leases: Lease[] }>("/rentals/");
  const [view, setView] = useQueryState("view", "applications");
  const [query, setQuery] = useQueryState("q");
  const applications = resource.data?.applications ?? [];
  const leases = resource.data?.leases ?? [];
  const shownApplications = applications.filter((item) => matches(query, item.tenant, item.listing, item.property, item.id));
  const shownLeases = leases.filter((item) => matches(query, item.tenant, item.landlord, item.property));
  const isLeases = view === "leases";

  return (
    <>
      <PageHeader
        title="Rentals"
      />
      <Panel
        title={isLeases ? "Recent leases" : "Recent applications"}
        meta={resource.data ? (isLeases
          ? countMeta(shownLeases.length, leases.length, ["lease", "leases"])
          : countMeta(shownApplications.length, applications.length, ["application", "applications"])) : undefined}
      >
        <Toolbar>
          <SearchField label="Filter rentals" placeholder={isLeases ? "Tenant, landlord or property" : "Applicant, listing or property"} value={query} onChange={setQuery} />
          {resource.data ? (
            <FilterTabs
              label="Records"
              value={isLeases ? "leases" : "applications"}
              onChange={setView}
              options={[
                { value: "applications", label: "Applications", count: shownApplications.length },
                { value: "leases", label: "Leases", count: shownLeases.length },
              ]}
            />
          ) : null}
        </Toolbar>
        <ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} />
        {resource.data ? (isLeases ? (
          shownLeases.length ? (
            <DataTable label="Leases">
              <thead><tr><th>Tenant</th><th>Landlord</th><th>Property</th><th>Status</th><th>Term</th><th>Created</th></tr></thead>
              <tbody>{shownLeases.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.tenant}</strong></td>
                  <td>{item.landlord}</td>
                  <td>{item.property}</td>
                  <td><Status value={item.status} /></td>
                  <td>{formatDay(item.starts_on)} – {item.ends_on ? formatDay(item.ends_on) : "Open-ended"}</td>
                  <td className="is-date">{formatDate(item.created_at)}</td>
                </tr>
              ))}</tbody>
            </DataTable>
          ) : <Empty icon="leases" message={leases.length ? "No leases match this search." : "No leases yet."} />
        ) : (
          shownApplications.length ? (
            <DataTable label="Rental applications">
              <thead><tr><th>Applicant</th><th>Listing</th><th>Property</th><th>Status</th><th>Move-in</th><th>Submitted</th></tr></thead>
              <tbody>{shownApplications.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.tenant}</strong><span className="management-subtext management-mono">{item.id.slice(0, 8)}</span></td>
                  <td>{item.listing}</td>
                  <td>{item.property}</td>
                  <td><Status value={item.status} /></td>
                  <td>{item.move_in_from ? formatDay(item.move_in_from) : "—"}</td>
                  <td className="is-date">{formatDate(item.created_at)}</td>
                </tr>
              ))}</tbody>
            </DataTable>
          ) : <Empty icon="applications" message={applications.length ? "No applications match this search." : "No rental applications yet."} />
        )) : null}
      </Panel>
    </>
  );
}
