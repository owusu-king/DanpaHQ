"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Notice } from "@/components/Notice";
import { LoadingRows } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import { authedFetch } from "@/lib/auth";
import {
  getPayoutDestination,
  listOrganizations,
  type Organization,
  type PayoutDestinationState,
} from "@/lib/console";
import { useSession } from "@/lib/session";
import {
  expiryNotice,
  formatDecidedOn,
  KIND_LABEL,
  STATE_LABEL,
  type TrustEntry,
  type TrustState,
} from "@/lib/trust";

const RELEVANT_KINDS = {
  tenant: ["phone", "identity"],
  landlord: ["phone", "identity"],
  property_manager: ["phone", "identity"],
  agent: ["phone", "identity", "agency"],
} satisfies Record<string, string[]>;

type TrustPayload = { primary_role: string; trust: Record<string, TrustEntry> };
type SettlementOverview = {
  organization: Organization | null;
  mayManage: boolean;
  destination: PayoutDestinationState | null;
};

/**
 * One calm overview. Evidence collection and payout details have their own
 * destinations; this page answers what is ready, what needs attention and
 * where to continue without rendering either workflow in the summary.
 */
export default function VerificationSettingsPage() {
  const { state, activeContext } = useSession();
  const [payload, setPayload] = useState<TrustPayload | null>(null);
  const [settlement, setSettlement] = useState<SettlementOverview | null | undefined>();
  const [error, setError] = useState("");
  const [settlementError, setSettlementError] = useState("");

  const loadTrust = useCallback(async () => {
    try {
      setPayload(await authedFetch<TrustPayload>("/me/"));
      setError("");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure
          ? cause.error.message
          : "Could not load your verification standing.",
      );
    }
  }, []);

  const loadSettlement = useCallback(async () => {
    // The Portfolio's settlement account, which belongs to whoever operates the
    // Portfolio — an invited administrator included. Gating this on their own
    // provider journey hid it from exactly the people it is a task for.
    const operating = state.status === "signed_in"
      && (state.me.capabilities.provider.workspace_access
        || state.me.capabilities.provider.exists);
    if (!operating) {
      setSettlement(null);
      return;
    }
    try {
      const organizations = await listOrganizations();
      const contextualId = activeContext?.startsWith("organization:")
        ? activeContext.slice("organization:".length)
        : "";
      const organization =
        organizations.find((row) => row.id === contextualId) ?? organizations[0] ?? null;
      if (!organization) {
        setSettlement({ organization: null, mayManage: false, destination: null });
        setSettlementError("");
        return;
      }
      const mayManage = ["owner", "admin"].includes(organization.current_user_role);
      const destination = mayManage ? await getPayoutDestination(organization.id) : null;
      setSettlement({ organization, mayManage, destination });
      setSettlementError("");
    } catch (cause) {
      setSettlementError(
        cause instanceof ApiFailure
          ? cause.error.message
          : "Could not load the settlement-account check.",
      );
    }
  }, [activeContext, state]);

  useEffect(() => { void loadTrust(); }, [loadTrust]);
  useEffect(() => { void loadSettlement(); }, [loadSettlement]);

  const me = state.status === "signed_in" ? state.me : null;
  const kinds =
    RELEVANT_KINDS[payload?.primary_role as keyof typeof RELEVANT_KINDS]
    ?? RELEVANT_KINDS.tenant;

  // How much of this person's standing is confirmed, for the meter in the head.
  const personal = payload ? kinds.map((kind) => (payload.trust[kind] ?? emptyTrustEntry).state) : [];
  const providerState = me?.capabilities.provider.exists
    ? providerTrustState(me.capabilities.provider.verification_status)
    : null;
  const states = providerState ? [...personal, providerState] : personal;
  const confirmed = states.filter((value) => value === "verified").length;

  return (
    <section className="verification-overview" aria-labelledby="verification-title">
      <header className="verification-heading">
        <div>
          <h2 id="verification-title">Verification</h2>
          <p>See what Danpa HQ has confirmed and continue only the checks that need you.</p>
        </div>
        {payload ? (
          <div className="verification-meter" role="img" aria-label={`${confirmed} of ${states.length} checks confirmed`}>
            <span><strong>{confirmed}</strong> of {states.length} confirmed</span>
            <i aria-hidden="true"><b style={{ width: `${states.length ? (confirmed / states.length) * 100 : 0}%` }} /></i>
          </div>
        ) : null}
      </header>

      {error ? <Notice tone="error" title={error} /> : null}
      {!payload && !error ? <LoadingRows rows={3} /> : null}

      {payload ? (
        <div className="verification-list" aria-label="Account verification">
          {kinds.map((kind) => {
            const entry = payload.trust[kind] ?? emptyTrustEntry;
            const notice = expiryNotice(entry.expires_at);
            const isIdentity = kind === "identity";
            return (
              <VerificationRow
                key={kind}
                title={KIND_LABEL[kind] ?? kind}
                state={entry.state}
                detail={notice ?? personalCheckDetail(kind, entry)}
                actionHref={isIdentity && entry.state !== "verified"
                  ? "/settings/verification/identity"
                  : undefined}
                actionLabel={isIdentity
                  ? entry.state === "pending" ? "View" : "Continue"
                  : undefined}
              />
            );
          })}

          {me?.capabilities.provider.exists ? (
            <VerificationRow
              title="Provider verification"
              state={providerTrustState(me.capabilities.provider.verification_status)}
              statusLabel={providerStatusLabel(me.capabilities.provider.verification_status)}
              detail="Your approval to operate property services on Danpa HQ."
              actionHref="/provider"
              actionLabel="View"
            />
          ) : null}

          {me?.capabilities.provider.workspace_access || me?.capabilities.provider.exists ? (
            <SettlementRow settlement={settlement} error={settlementError} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SettlementRow({
  settlement,
  error,
}: {
  settlement: SettlementOverview | null | undefined;
  error: string;
}) {
  if (error) {
    return (
      <VerificationRow
        title="Bank or Mobile Money"
        state="unverified"
        statusLabel="Unavailable"
        detail={error}
      />
    );
  }
  if (settlement === undefined) {
    return (
      <VerificationRow
        title="Bank or Mobile Money"
        state="pending"
        statusLabel="Loading"
        detail="Checking your active Portfolio."
      />
    );
  }
  if (!settlement?.organization) {
    return (
      <VerificationRow
        title="Bank or Mobile Money"
        state="unverified"
        statusLabel="Portfolio needed"
        detail="Create a Portfolio before adding a receiving account."
      />
    );
  }
  if (!settlement.mayManage) {
    return (
      <VerificationRow
        title="Bank or Mobile Money"
        state="unverified"
        statusLabel="Owner managed"
        detail={`${settlement.organization.name} · An owner or admin manages receiving details.`}
      />
    );
  }

  const profile = settlement.destination?.active_profile ?? settlement.destination?.profile;
  const savedProfiles = settlement.destination?.profiles ?? [];
  const verified = profile?.status === "verified";
  return (
    <VerificationRow
      title="Bank or Mobile Money"
      state={verified ? "verified" : profile ? "pending" : "unverified"}
      statusLabel={verified ? "Verified" : profile ? profile.status_display : savedProfiles.length ? "Selection needed" : "Not set up"}
      detail={profile
        ? `${settlement.organization.name} · ${profile.institution} · ${profile.masked_account}`
        : savedProfiles.length
          ? `${settlement.organization.name} · Choose which verified account should receive new rent payments.`
          : `${settlement.organization.name} · Add where Paystack should send rent.`}
      actionHref={`/settings/settlement?organization=${settlement.organization.id}`}
      actionLabel={profile || savedProfiles.length ? "Manage" : "Set up"}
    />
  );
}

function VerificationRow({
  title,
  state,
  detail,
  statusLabel,
  actionHref,
  actionLabel,
}: {
  title: string;
  state: TrustState;
  detail: string;
  statusLabel?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <article className={`verification-row is-${state}`}>
      <span className="verification-marker" aria-hidden="true">
        {state === "verified" ? "✓" : state === "pending" ? "·" : state === "expired" ? "!" : "○"}
      </span>
      <div className="verification-copy">
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
      <div className="verification-state">
        <span>{statusLabel ?? STATE_LABEL[state]}</span>
        {actionHref && actionLabel ? <Link href={actionHref as never}>{actionLabel} →</Link> : null}
      </div>
    </article>
  );
}

const emptyTrustEntry: TrustEntry = {
  state: "unverified",
  decided_at: null,
  expires_at: null,
  method: "",
};

function personalCheckDetail(kind: string, entry: TrustEntry): string {
  const decided = formatDecidedOn(entry.decided_at);
  if (entry.state === "verified") {
    return decided ? `Confirmed ${decided}.` : "Confirmed on your account.";
  }
  if (entry.state === "pending") {
    return "With the verification team. We will notify you when it changes.";
  }
  if (entry.state === "expired") return "This check needs to be completed again.";
  if (kind === "phone") return "Confirm your phone number during sign in.";
  if (kind === "identity") return "Use a government-issued identity document.";
  return "Complete this through your provider verification when it is required.";
}

function providerTrustState(status: string | null): TrustState {
  if (status === "approved") return "verified";
  if (status === "pending") return "pending";
  if (status === "expired") return "expired";
  return "unverified";
}

function providerStatusLabel(status: string | null): string {
  return {
    approved: "Approved",
    pending: "In review",
    needs_more_info: "Action needed",
    rejected: "Not approved",
    revoked: "Revoked",
    expired: "Out of date",
    not_started: "Not started",
  }[status ?? "not_started"] ?? "Not started";
}
