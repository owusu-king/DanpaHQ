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
import { PanelSkeleton, PanelState, WorkspaceHead } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import { type Lease } from "@/lib/console";
import { useSession } from "@/lib/session";
import { requestRecordId, requestWho } from "@/lib/tenancyRequests";
import { listMyApplications, listMyLeases, type MyApplication } from "@/lib/tenant";
import { onDate } from "@/lib/time";
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
  const { items, portfolioName, error, unauthorised, reload } = useProviderRequests();

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
          <section className="ws-panel request-record-panel"><RequestRecord item={item} portfolioName={portfolioName} onChanged={reload} /></section>
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

  const missing = applications !== null && !error && !application;

  // The sheet the list opens, laid on the page: the same header words, the same
  // record, one level deeper in the same workspace.
  return (
    <div className="ws-page applications-workspace application-record-page">
      <WorkspaceHead
        icon="applications"
        title={missing ? "Application" : "Your application"}
        summary={application ? `Sent ${onDate(application.created_at)}` : null}
        path={
          <EntityPath
            items={[
              { label: "Applications", href: "/applications", mobileLabel: "Back to Applications" },
              { label: application ? application.property_title || application.listing_headline : "Application" },
            ]}
          />
        }
      />

      <section className="ws-panel request-record-panel" aria-busy={applications === null || undefined}>
        {applications === null ? (
          <PanelSkeleton rows={3} />
        ) : error ? (
          <PanelState
            tone="error"
            icon="warning"
            title="Your application didn’t load"
            body={error}
            action={<button type="button" className="ws-action" onClick={() => void load()}>Try again</button>}
          />
        ) : application ? (
          <ApplicationRecord
            key={application.id}
            application={application}
            leases={leases}
            onChanged={load}
          />
        ) : (
          <PanelState
            icon="applications"
            title="Application not found"
            body="It may have been withdrawn, or the listing is no longer available. Your other applications are still on the list."
            action={<Link href="/applications" className="ws-action is-primary">Back to Applications</Link>}
          />
        )}
      </section>
    </div>
  );
}
