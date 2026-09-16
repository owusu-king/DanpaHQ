"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Notice } from "@/components/Notice";
import { Empty, LoadingRows, PageHeader, Section } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import {
  findTenancy,
  listMyTenancies,
  tenancyLabel,
  type Tenancy,
} from "@/lib/tenancy";

/**
 * One tenancy, and everything that belongs to it.
 *
 * The tenancy is identified by the route, which is the whole point: a tenant
 * may hold several, and picking one has to be something they did rather than
 * something a previous screen left behind. There is no "current tenancy" in
 * state anywhere for this page to inherit.
 *
 * Rent, maintenance, notices and documents will hang off this page as their
 * phases land. They are per-tenancy by nature — a maintenance request is about
 * *this* flat — while Explore, saved places, applications, viewings and the
 * account stay outside every tenancy, because they belong to the person.
 */
export default function TenancyPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [tenancies, setTenancies] = useState<Tenancy[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    listMyTenancies()
      .then((rows) => { if (!cancelled) setTenancies(rows); })
      .catch((cause) => {
        if (cancelled) return;
        setTenancies([]);
        setError(
          cause instanceof ApiFailure ? cause.error.message : "Could not load this tenancy.",
        );
      });
    return () => { cancelled = true; };
  }, []);

  if (tenancies === null) {
    return (<><PageHeader title="Your home" /><LoadingRows rows={3} /></>);
  }

  const tenancy = findTenancy(tenancies, id);

  if (!tenancy) {
    return (
      <>
        <PageHeader title="Your home" />
        {error ? <Notice tone="error" title={error} /> : null}
        <Empty
          icon="warning"
          title="This tenancy is not one of yours"
          body="It may have ended, or the link may be wrong."
          action={<Link href="/home" className="type-body-strong">Back to your homes →</Link>}
        />
      </>
    );
  }

  const due = tenancy.rent?.next_due ?? null;
  const others = tenancies.length > 1;

  return (
    <>
      <PageHeader
        title={tenancy.property.title}
        description={[
          tenancyLabel(tenancy),
          tenancy.property.locality,
          tenancy.property.district,
        ].filter(Boolean).join(" · ")}
        actions={
          others ? <Link href="/home">All your homes</Link> : undefined
        }
      />

      {due?.is_overdue ? (
        <div style={{ marginBottom: "var(--space-6)" }}>
          <Notice
            tone="warning"
            title={`${due.kind_display} overdue`}
            body={`${due.amount_formatted ?? "An amount"} was due ${formatDate(due.due_on)}.`}
          />
        </div>
      ) : null}

      <Section title="Agreement">
        {tenancy.lease ? (
          <div className="portal-panel">
            <dl className="portal-figures" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
              <div className="portal-figure">
                <dt>Rent</dt>
                <dd>{tenancy.lease.rent_formatted ?? "Not set"}</dd>
                <dt style={{ fontSize: "0.6875rem" }}>
                  per {tenancy.lease.rent_period === "yearly" ? "year" : "month"}
                </dt>
              </div>
              <div className="portal-figure">
                <dt>Status</dt>
                <dd style={{ fontSize: "0.9375rem", fontFamily: "var(--font-body)" }}>
                  {tenancy.lease.status_display}
                </dd>
              </div>
              {tenancy.lease.starts_on ? (
                <div className="portal-figure">
                  <dt>Started</dt>
                  <dd style={{ fontSize: "0.9375rem", fontFamily: "var(--font-body)" }}>
                    {formatDate(tenancy.lease.starts_on)}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : (
          <Empty
            icon="leases"
            title="Lease required before activation"
            body="Your provider must send a lease and you must accept it before Rooomly can activate this tenancy."
          />
        )}
      </Section>

      <Section
        title="Rent"
        action={tenancy.lease ? (
          <Link href={`/payments/${tenancy.lease.id}?mode=tenant` as never}>Rent account</Link>
        ) : null}
      >
        {tenancy.rent && tenancy.rent.outstanding_count > 0 ? (
          <ul className="portal-rows">
            <li className="portal-row">
              <div className="portal-row-main">
                <span className="portal-row-title">{due?.kind_display ?? "Next payment"}</span>
                <span className="portal-row-meta">
                  {due ? `Due ${formatDate(due.due_on)}` : ""}
                  {tenancy.rent.outstanding_count > 1
                    ? ` · ${tenancy.rent.outstanding_count} items outstanding`
                    : ""}
                </span>
              </div>
              <div className="portal-row-side">
                <span
                  className="portal-amount"
                  style={due?.is_overdue ? { color: "var(--color-laterite-600)" } : undefined}
                >
                  {due?.amount_formatted ?? "—"}
                </span>
                <span className="type-caption">
                  {tenancy.rent.overdue_count > 0 ? "Overdue" : "Outstanding"}
                </span>
              </div>
            </li>
          </ul>
        ) : (
          <Empty
            icon="payments"
            title="Nothing outstanding"
            body="Charges appear here as your landlord raises them."
          />
        )}
      </Section>
    </>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}
