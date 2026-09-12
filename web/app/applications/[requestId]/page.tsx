"use client";

/**
 * One application or tenancy request, at its own address.
 *
 * Branches the same way `/applications` does, and for the same reason: it is
 * one idea — "the application record that concerns me" — read from whichever
 * side this account is on. A tenant sees what they sent; a provider sees what
 * they received. The endpoints differ and the backend scopes each to the
 * caller, so this branch is presentation, not permission.
 *
 * Both were panes before. The provider's held a decision about a person; the
 * tenant's held a timeline and one irreversible action. Neither could be linked
 * to, and the phone had already given the tenant's an address of its own.
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ApplicationRecord } from "@/components/applications/ApplicationRecord";
import { Notice } from "@/components/Notice";
import { LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { EntityPath } from "@/components/property/WorkspacePatterns";
import { RequestRecord } from "@/components/requests/RequestRecord";
import { ApiFailure } from "@/lib/api";
import { type Lease } from "@/lib/console";
import { useSession } from "@/lib/session";
import { requestRecordId, requestWho } from "@/lib/tenancyRequests";
import { listMyApplications, listMyLeases, type MyApplication } from "@/lib/tenant";
import { useProviderRequests } from "@/lib/useProviderRequests";

export default function ApplicationRecordPage() {
  const { state } = useSession();
  if (state.status === "loading") {
    return (
      <>
        <PageHeader title="Application" />
        <LoadingRows rows={4} />
      </>
    );
  }
  if (state.status !== "signed_in") return null;
  const capabilities = state.me.capabilities;
  const asProvider =
    capabilities.active_workspace === "provider" && capabilities.provider.workspace_access;
  return asProvider ? <ProviderRequest /> : <TenantApplication />;
}

function ProviderRequest() {
  const { requestId } = useParams<{ requestId: string }>();
  const router = useRouter();
  const { items, error, unauthorised, reload } = useProviderRequests();

  useEffect(() => {
    if (unauthorised) router.push("/sign-in");
  }, [router, unauthorised]);

  const item = items?.find((row) => requestRecordId(row) === requestId) ?? null;
  const kindLabel = item?.kind === "application" ? "Public listing" : "Direct request";

  return (
    <div className="requests-workspace">
      <EntityPath
        items={[
          { label: "Tenancy requests", href: "/applications", mobileLabel: "Back to requests" },
          { label: item ? requestWho(item) : "Request" },
        ]}
      />

      {items === null ? (
        <>
          <PageHeader title="Request" />
          <LoadingRows rows={4} />
        </>
      ) : error ? (
        <Notice tone="error" title={error} />
      ) : item ? (
        <>
          <PageHeader title={requestWho(item)} description={kindLabel} />
          <RequestRecord item={item} onChanged={reload} />
        </>
      ) : (
        <>
          <PageHeader
            title="Request not found"
            description="It may have been withdrawn, or it belongs to a Portfolio other than the one you are in. Switching Portfolio from the account menu opens that Portfolio's requests."
          />
          <p className="type-caption">
            <Link href="/applications">Back to tenancy requests</Link>
          </p>
        </>
      )}
    </div>
  );
}

function TenantApplication() {
  const { requestId } = useParams<{ requestId: string }>();
  const [applications, setApplications] = useState<MyApplication[] | null>(null);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      // Acceptance is not the end of the story, and the story lives in the
      // lease — the same read-only join the list makes.
      const [nextApplications, nextLeases] = await Promise.all([
        listMyApplications(),
        listMyLeases().catch(() => [] as Lease[]),
      ]);
      setApplications(nextApplications);
      setLeases(nextLeases);
      setError("");
    } catch (cause) {
      setApplications([]);
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not load your application.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const application = applications?.find((row) => row.id === requestId) ?? null;

  return (
    <div className="applications">
      <EntityPath
        items={[
          { label: "Applications", href: "/applications", mobileLabel: "Back to Applications" },
          { label: application ? application.listing_headline : "Application" },
        ]}
      />

      {applications === null ? (
        <>
          <PageHeader title="Application" />
          <LoadingRows rows={4} />
        </>
      ) : error ? (
        <Notice tone="error" title={error} />
      ) : application ? (
        <ApplicationRecord
          key={application.id}
          application={application}
          leases={leases}
          onChanged={load}
        />
      ) : (
        <>
          <PageHeader
            title="Application not found"
            description="It may have been withdrawn, or the listing is no longer available."
          />
          <p className="type-caption">
            <Link href="/applications">Back to Applications</Link>
          </p>
        </>
      )}
    </div>
  );
}
