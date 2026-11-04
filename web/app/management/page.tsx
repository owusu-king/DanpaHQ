"use client";

import Link from "next/link";

import { PageHeader, Panel, ResourceState, useResource } from "@/components/management/ManagementUI";
import { Icon } from "@/components/portal/icons";
import { useManagement } from "@/lib/management";

type Dashboard = { counts: Record<string, number>; role: string };

/** Work waiting on the team, in the order it is usually picked up. */
const QUEUES = [
  ["pending_verifications", "Verification reviews", "Properties, providers and artisans waiting for a decision", "/management/verifications", "view_verifications"],
  ["open_support_cases", "Support cases", "Customer tickets that are open or in hand", "/management/support", "view_support"],
  ["open_reports", "Reports", "Reported people, properties and listings to triage", "/management/reports", "view_reports"],
  ["pending_listings", "Listing reviews", "Submissions waiting to go public", "/management/listings", "view_properties"],
] as const;

/** Context for answering customers, not a to-do list. */
const FIGURES = [
  ["open_applications", "Open rental applications", "/management/rentals", "view_rentals"],
  ["active_leases", "Active leases", "/management/rentals", "view_rentals"],
  ["users", "Consumer accounts", "/management/users", "view_users"],
] as const;

export default function ManagementDashboard() {
  const { can, state } = useManagement();
  const resource = useResource<Dashboard>("/dashboard/");
  const counts = resource.data?.counts;
  const user = state.status === "signed_in" ? state.user : null;
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const queues = QUEUES.filter(([, , , , capability]) => can(capability));
  const figures = FIGURES.filter(([, , , capability]) => can(capability));

  return (
    <>
      <PageHeader
        title={user ? `Good day, ${user.first_name}` : "Overview"}
        description={`${today}${user ? ` · ${user.role_label}` : ""}`}
      />
      {resource.loading || resource.error ? (
        <Panel><ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} /></Panel>
      ) : null}
      {counts ? (
        <div className="management-overview">
          {queues.length ? (
            <Panel title="Waiting on the team">
              <ul className="management-queues">
                {queues.map(([key, label, , href]) => {
                  const count = counts[key] ?? 0;
                  return (
                    <li key={key}>
                      <Link href={href as never} className={`management-queue ${count ? "is-waiting" : "is-clear"}`}>
                        <span><strong>{label}</strong></span>
                        <span className="management-queue-count">{count ? count.toLocaleString("en-GH") : "Clear"}</span>
                        <Icon name="chevron-down" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}
          {figures.length ? (
            <Panel title="On the platform">
              <dl className="management-figures">
                {figures.map(([key, label, href]) => (
                  <div key={key}>
                    <dt><Link href={href as never}>{label}</Link></dt>
                    <dd>{(counts[key] ?? 0).toLocaleString("en-GH")}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          ) : null}
        </div>
      ) : null}
      {counts && !queues.length && !figures.length ? (
        <Panel><EmptyRole /></Panel>
      ) : null}
    </>
  );
}

function EmptyRole() {
  return (
    <div className="management-empty">
      <span className="management-empty-mark" aria-hidden="true"><Icon name="home" /></span>
    </div>
  );
}
