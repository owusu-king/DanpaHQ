"use client";

/**
 * One viewing, at its own address.
 *
 * Branches the same way `/viewings` does, and for the same reason: it is one
 * idea — "the viewing that concerns me" — read from whichever side this account
 * is on. A host offers times, checks somebody in and settles attendance; a
 * tenant picks a time, finds the place and shows a code on arrival. The
 * endpoints differ and the backend scopes each to the caller, so this branch is
 * presentation, not permission.
 *
 * Both were panes that fell back to opening the first row, so arriving at
 * Viewings meant reading somebody's appointment chosen by sort order. And a
 * viewing is the strongest case of the six for having an address: it is a
 * workflow that runs across a day, often from a different device than the one
 * it started on.
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Notice } from "@/components/Notice";
import { LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { EntityPath } from "@/components/property/WorkspacePatterns";
import { ViewingRecord } from "@/components/tenant/ViewingRecord";
import { ProviderViewingRecord } from "@/components/viewings/ProviderViewingRecord";
import { ApiFailure } from "@/lib/api";
import { listHostViewings, type Viewing } from "@/lib/console";
import { providerViewingSummary } from "@/lib/providerViewings";
import { useSession } from "@/lib/session";
import { listMyViewings, type MyViewing } from "@/lib/tenant";
import { placeOf, standing } from "@/lib/viewingMeaning";

export default function ViewingRecordPage() {
  const { state } = useSession();
  if (state.status === "loading") {
    return (
      <>
        <PageHeader title="Viewing" />
        <LoadingRows rows={4} />
      </>
    );
  }
  if (state.status !== "signed_in") return null;
  const capabilities = state.me.capabilities;
  const asProvider =
    capabilities.active_workspace === "provider" && capabilities.provider.workspace_access;
  return asProvider ? <HostViewing /> : <TenantViewing />;
}

function HostViewing() {
  const { viewingId } = useParams<{ viewingId: string }>();
  const router = useRouter();
  const [viewings, setViewings] = useState<Viewing[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setViewings(await listHostViewings(false));
      setError("");
    } catch (cause) {
      if (cause instanceof ApiFailure && (cause.status === 401 || cause.status === 403)) {
        router.push("/sign-in");
        return;
      }
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this viewing.");
      setViewings([]);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const viewing = viewings?.find((row) => row.id === viewingId) ?? null;

  return (
    <div className="viewings-workspace">
      <EntityPath
        items={[
          { label: "Viewings", href: "/viewings", mobileLabel: "Back to Viewings" },
          { label: viewing ? viewing.tenant_name : "Viewing" },
        ]}
      />

      {viewings === null ? (
        <>
          <PageHeader title="Viewing" />
          <LoadingRows rows={4} />
        </>
      ) : error ? (
        <Notice tone="error" title={error} />
      ) : viewing ? (
        <>
          <PageHeader
            title={viewing.tenant_name}
            description={`${providerViewingSummary(viewing).label} · ${viewing.listing_headline}`}
          />
          <ProviderViewingRecord key={viewing.id} viewing={viewing} onChanged={load} />
        </>
      ) : (
        <>
          <PageHeader
            title="Viewing not found"
            description="It may have been withdrawn, or it belongs to a Property you no longer host."
          />
          <p className="type-caption">
            <Link href="/viewings">Back to Viewings</Link>
          </p>
        </>
      )}
    </div>
  );
}

function TenantViewing() {
  const { viewingId } = useParams<{ viewingId: string }>();
  const [viewings, setViewings] = useState<MyViewing[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setViewings(await listMyViewings());
      setError("");
    } catch (cause) {
      setViewings([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your viewing.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const viewing = viewings?.find((row) => row.id === viewingId) ?? null;

  return (
    <div className="viewings">
      <EntityPath
        items={[
          { label: "Viewings", href: "/viewings", mobileLabel: "Back to Viewings" },
          { label: viewing ? viewing.listing_headline : "Viewing" },
        ]}
      />

      {viewings === null ? (
        <>
          <PageHeader title="Viewing" />
          <LoadingRows rows={4} />
        </>
      ) : error ? (
        <Notice tone="error" title={error} />
      ) : viewing ? (
        <>
          <PageHeader
            title={viewing.listing_headline}
            description={`${standing(viewing).line} · ${placeOf(viewing)}`}
          />
          <ViewingRecord key={viewing.id} viewing={viewing} onChanged={load} />
        </>
      ) : (
        <>
          <PageHeader
            title="Viewing not found"
            description="It may have been withdrawn, or the listing is no longer available."
          />
          <p className="type-caption">
            <Link href="/viewings">Back to Viewings</Link>
          </p>
        </>
      )}
    </div>
  );
}
