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

import { Button } from "@/components/Button";
import { LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { Icon } from "@/components/portal/icons";
import { EntityPath } from "@/components/property/WorkspacePatterns";
import { ViewingRecord } from "@/components/tenant/ViewingRecord";
import { ProviderViewingRecord } from "@/components/viewings/ProviderViewingRecord";
import { PanelSkeleton, PanelState, WorkspaceHead } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import { listHostViewings, type Viewing } from "@/lib/console";
import { providerViewingSummary } from "@/lib/providerViewings";
import { useSession } from "@/lib/session";
import { listMyViewings, type MyViewing } from "@/lib/tenant";
import { standing } from "@/lib/viewingMeaning";

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

  const summary = viewing ? providerViewingSummary(viewing) : null;
  const path = (
    <EntityPath
      items={[
        { label: "Viewings", href: "/viewings", mobileLabel: "Back to Viewings" },
        { label: viewing ? viewing.tenant_name : "Viewing" },
      ]}
    />
  );

  if (viewings === null) {
    return (
      <div className="ws-page viewings-workspace">
        <WorkspaceHead icon="viewings" title="Viewing" path={path} />
        <section className="ws-panel" aria-busy="true" aria-label="Viewing"><PanelSkeleton rows={4} /></section>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ws-page viewings-workspace">
        <WorkspaceHead icon="viewings" title="Viewing" path={path} />
        <section className="ws-panel" aria-label="Viewing">
          <PanelState
            tone="error"
            icon="warning"
            title="This viewing didn’t load"
            body={error}
            action={<Button variant="secondary" size="sm" onClick={() => { setViewings(null); void load(); }}>Try again</Button>}
          />
        </section>
      </div>
    );
  }

  if (!viewing || !summary) {
    return (
      <div className="ws-page viewings-workspace">
        <WorkspaceHead icon="viewings" title="Viewing not found" path={path} />
        <section className="ws-panel" aria-label="Viewing">
          <PanelState
            icon="viewings"
            title="This viewing isn’t on your agenda"
            body="It may have been withdrawn, or it belongs to a Property you no longer host."
            action={<Link href="/viewings" className="btn btn-quiet btn-sm">Back to Viewings</Link>}
          />
        </section>
      </div>
    );
  }

  return (
    <div className="ws-page viewings-workspace">
      <WorkspaceHead
        icon="viewings"
        title={viewing.tenant_name}
        path={path}
        mark={(
          <span className="viewing-record-mark" aria-hidden="true">
            {viewing.photo_url ? (
              /* Short-lived signed URLs from the files service. */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={viewing.photo_url} alt="" />
            ) : <Icon name="viewings" />}
          </span>
        )}
        summary={(
          <>
            <span className={`viewing-row-state is-${summary.tone}`}><i aria-hidden="true" />{summary.label}</span>
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {viewing.listing_headline}
          </>
        )}
      />
      <section className="ws-panel viewing-record-panel" aria-label={`Viewing for ${viewing.tenant_name}`}>
        <ProviderViewingRecord key={viewing.id} viewing={viewing} onChanged={load} />
      </section>
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
      // Kept, not blanked: the record polls during check-in, and one failed
      // read must not take the appointment off the screen.
      setViewings((current) => current ?? []);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your viewing.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const viewing = viewings?.find((row) => row.id === viewingId) ?? null;
  const missing = viewings !== null && !error && !viewing;

  // The sheet the schedule opens, laid on the page: the same words, the same
  // record, one level deeper in the same workspace.
  return (
    <div className="ws-page viewings-workspace tenant-viewing-page">
      <WorkspaceHead
        icon="viewings"
        title={missing ? "Viewing" : "Your viewing"}
        summary={viewing ? standing(viewing).line : null}
        path={
          <EntityPath
            items={[
              { label: "Viewings", href: "/viewings", mobileLabel: "Back to Viewings" },
              { label: viewing ? viewing.property_title || viewing.listing_headline : "Viewing" },
            ]}
          />
        }
      />

      <section className="ws-panel request-record-panel tenant-viewing-panel" aria-busy={viewings === null || undefined}>
        {viewings === null ? (
          <PanelSkeleton rows={3} />
        ) : viewing ? (
          <ViewingRecord key={viewing.id} viewing={viewing} onChanged={load} />
        ) : error ? (
          <PanelState
            tone="error"
            icon="warning"
            title="Your viewing didn’t load"
            body={error}
            action={<button type="button" className="ws-action" onClick={() => void load()}>Try again</button>}
          />
        ) : (
          <PanelState
            icon="viewings"
            title="Viewing not found"
            body="It may have been withdrawn, or the listing is no longer available. Your other viewings are still on the schedule."
            action={<Link href="/viewings" className="ws-action is-primary">Back to Viewings</Link>}
          />
        )}
      </section>
    </div>
  );
}
