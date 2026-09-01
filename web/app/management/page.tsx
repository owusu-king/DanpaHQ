"use client";

import Link from "next/link";

import { PageHeader, ResourceState, useResource } from "@/components/management/ManagementUI";
import { useManagement } from "@/lib/management";

type Dashboard = { counts: Record<string, number>; role: string };

const METRICS = [
  ["pending_verifications", "Verification reviews", "/management/verifications", "view_verifications"],
  ["pending_listings", "Listing reviews", "/management/listings", "view_properties"],
  ["open_reports", "Open reports", "/management/reports", "view_reports"],
  ["open_support_cases", "Support cases", "/management/support", "view_support"],
  ["open_applications", "Rental applications", "/management/rentals", "view_rentals"],
  ["active_leases", "Active leases", "/management/rentals", "view_rentals"],
  ["users", "Consumer accounts", "/management/users", "view_users"],
] as const;

export default function ManagementDashboard() {
  const { can, state } = useManagement();
  const resource = useResource<Dashboard>("/dashboard/");
  return (
    <>
      <PageHeader
        eyebrow="Operations overview"
        title={`Good day${state.status === "signed_in" ? `, ${state.user.first_name}` : ""}.`}
        description="The queues below reflect live operational state. Property verification is one decision; customer support and Super Admin configuration remain separate."
      />
      <ResourceState loading={resource.loading} error={resource.error} />
      {resource.data ? (
        <div className="management-grid">
          {METRICS.filter(([, , , capability]) => can(capability)).map(([key, label, href]) => (
            <article className="management-metric" key={key}>
              <span>{label}</span>
              <strong>{resource.data?.counts[key] ?? 0}</strong>
              <Link href={href as never}>Open workspace →</Link>
            </article>
          ))}
        </div>
      ) : null}
    </>
  );
}
