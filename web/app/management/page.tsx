"use client";

import Link from "next/link";

import { PageHeader, ResourceState, useResource } from "@/components/management/ManagementUI";
import { Icon, type IconName } from "@/components/portal/icons";
import { useManagement } from "@/lib/management";

type Dashboard = { counts: Record<string, number>; role: string };

/**
 * A queue is work waiting on somebody here; a count is a fact about the
 * platform. They were seven identical boxes with a number in each, which made
 * "nine verifications nobody has looked at" and "twelve thousand accounts
 * exist" the same object at the same weight.
 *
 * `kind` is what separates them: a queue with anything in it is marked and
 * sorted forward, a count never is, and a queue at zero says so in words rather
 * than showing a nought that reads as a failure to load.
 */
type Metric = {
  key: string;
  label: string;
  /** What the number counts, so the tile is not a bare figure. */
  meta: string;
  href: string;
  capability: string;
  icon: IconName;
  kind: "queue" | "count";
};

const METRICS: readonly Metric[] = [
  { key: "pending_verifications", label: "Verification reviews", meta: "Waiting on a decision", href: "/management/verifications", capability: "view_verifications", icon: "verification", kind: "queue" },
  { key: "pending_listings", label: "Listing reviews", meta: "Submitted, not yet published", href: "/management/listings", capability: "view_properties", icon: "listings", kind: "queue" },
  { key: "open_reports", label: "Open reports", meta: "Raised against a listing or account", href: "/management/reports", capability: "view_reports", icon: "reports", kind: "queue" },
  { key: "open_support_cases", label: "Support cases", meta: "Open conversations", href: "/management/support", capability: "view_support", icon: "support", kind: "queue" },
  { key: "open_applications", label: "Rental applications", meta: "In flight across the platform", href: "/management/rentals", capability: "view_rentals", icon: "applications", kind: "count" },
  { key: "active_leases", label: "Active leases", meta: "Currently running", href: "/management/rentals", capability: "view_rentals", icon: "leases", kind: "count" },
  { key: "users", label: "Consumer accounts", meta: "Registered on the platform", href: "/management/users", capability: "view_users", icon: "users", kind: "count" },
] as const;

export default function ManagementDashboard() {
  const { can, state } = useManagement();
  const resource = useResource<Dashboard>("/dashboard/");
  const counts = resource.data?.counts;

  const visible = METRICS.filter((metric) => can(metric.capability));
  const queues = visible.filter((metric) => metric.kind === "queue");
  const facts = visible.filter((metric) => metric.kind === "count");
  const waiting = counts
    ? queues.reduce((total, metric) => total + (counts[metric.key] ?? 0), 0)
    : 0;

  return (
    <>
      <PageHeader
        eyebrow="Operations overview"
        title={`Good day${state.status === "signed_in" ? `, ${state.user.first_name}` : ""}.`}
        description="The queues below reflect live operational state. Property verification is one decision; customer support and Super Admin configuration remain separate."
      />
      <ResourceState loading={resource.loading} error={resource.error} />
      {counts ? (
        <>
          {queues.length ? (
            <section className="management-section" aria-labelledby="queues-title">
              <div className="management-section-head">
                <h2 id="queues-title">Waiting on a decision</h2>
                <span className="management-section-count" data-tone={waiting ? "attention" : "clear"}>
                  {waiting ? `${waiting} ${waiting === 1 ? "item" : "items"}` : "All queues clear"}
                </span>
              </div>
              <div className="management-grid">
                {queues.map((metric) => (
                  <MetricTile key={metric.key} metric={metric} value={counts[metric.key] ?? 0} />
                ))}
              </div>
            </section>
          ) : null}

          {facts.length ? (
            <section className="management-section" aria-labelledby="platform-title">
              <div className="management-section-head">
                <h2 id="platform-title">Across the platform</h2>
              </div>
              <div className="management-grid">
                {facts.map((metric) => (
                  <MetricTile key={metric.key} metric={metric} value={counts[metric.key] ?? 0} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/**
 * One reading, as a whole target.
 *
 * The tile used to be an `<article>` with a small "Open workspace →" link at
 * the bottom, so the number was the biggest thing on the card and the only
 * part of it you could not click. The card is the link now; the arrow is the
 * affordance, not the hit area.
 */
function MetricTile({ metric, value }: { metric: Metric; value: number }) {
  const waiting = metric.kind === "queue" && value > 0;
  return (
    <Link
      href={metric.href as never}
      className="management-metric"
      data-kind={metric.kind}
      data-waiting={waiting || undefined}
    >
      <span className="management-metric-head">
        <span className="management-metric-icon" aria-hidden="true">
          <Icon name={metric.icon} />
        </span>
        <span className="management-metric-arrow" aria-hidden="true">→</span>
      </span>
      <strong>{metric.kind === "queue" && value === 0 ? "Clear" : value.toLocaleString("en-GH")}</strong>
      <span className="management-metric-label">{metric.label}</span>
      <small>{metric.meta}</small>
    </Link>
  );
}
