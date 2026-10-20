"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { openEnquiries } from "@/components/enquiries/EnquiriesInbox";
import { CorrectionSheet, type CorrectionTarget } from "@/components/passport/CorrectionSheet";
import {
  HousingRecord,
  IdentitySection,
  NotRecorded,
  PassportCover,
  StatusLegend,
  Timeline,
} from "@/components/passport/PassportDocument";
import { SharedLinks } from "@/components/passport/SharedLinks";
import { ShareFlow } from "@/components/passport/ShareFlow";
import { Icon } from "@/components/portal/icons";
import { PageHeader } from "@/components/portal/PageHeader";
import { PanelSkeleton, PanelState, WorkspaceHead } from "@/components/workspace/Workspace";
import { useToast } from "@/components/toast/Toaster";
import { ApiFailure } from "@/lib/api";
import {
  correctionFor,
  dayMonthYear,
  duration,
  getMyPassport,
  listPassportShares,
  type MyPassport,
  type PassportCorrection,
  type PassportShare,
  type PassportTenancy,
} from "@/lib/passport";
import { useSession } from "@/lib/session";

/**
 * Housing Passport: the tenant's verified housing history, and who can see it.
 *
 * Read in the order a tenant wants it before applying somewhere: who this says
 * I am, what it says about where I've lived and how I paid, and who I've shown
 * it to. The cover is the summary; the record and the identity checks are the
 * evidence behind it; the links and the timeline sit beside them. Sharing is
 * the page's one action, so it is the head's action and the empty links panel's.
 */
export default function PassportPage() {
  const { state } = useSession();
  if (state.status === "loading") return <><PageHeader title="Housing Passport" /><PanelSkeleton rows={3} /></>;
  if (state.status !== "signed_in") return null;
  return <Passport />;
}

function Passport() {
  const { toast } = useToast();
  const [passport, setPassport] = useState<MyPassport | null>(null);
  const [error, setError] = useState("");
  const [shares, setShares] = useState<PassportShare[] | null>(null);
  const [sharesError, setSharesError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [reporting, setReporting] = useState<CorrectionTarget | null>(null);

  const loadPassport = useCallback(async () => {
    setError("");
    try {
      setPassport(await getMyPassport());
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Your passport didn’t load.");
    }
  }, []);

  const loadShares = useCallback(async () => {
    setSharesError("");
    try {
      setShares(await listPassportShares());
    } catch (cause) {
      setShares((current) => current ?? []);
      setSharesError(cause instanceof ApiFailure ? cause.error.message : "Your links didn’t load.");
    }
  }, []);

  useEffect(() => { void loadPassport(); void loadShares(); }, [loadPassport, loadShares]);

  const retry = useCallback(async () => {
    setRetrying(true);
    await Promise.all([loadPassport(), loadShares()]);
    setRetrying(false);
  }, [loadPassport, loadShares]);

  const replaceShare = useCallback((share: PassportShare) => {
    setShares((current) => {
      const rest = (current ?? []).filter((row) => row.id !== share.id);
      return [share, ...rest].sort((left, right) => right.created_at.localeCompare(left.created_at));
    });
  }, []);

  const reported = useCallback(() => {
    toast({ tone: "success", title: "Sent for review", description: "Danpa HQ will reply in Support. The record shows as disputed until then." });
    void loadPassport();
  }, [loadPassport, toast]);

  const summary = useMemo(() => {
    if (!passport) return null;
    const { tenancies, months, payments_confirmed } = passport.summary;
    if (!tenancies) return <span>Your verified housing record, built from tenancies on Danpa HQ</span>;
    return (
      <>
        <strong>{tenancies} tenanc{tenancies === 1 ? "y" : "ies"}</strong>
        <span className="ws-summary-sep" aria-hidden="true">·</span>
        {duration(months)} on record
        {payments_confirmed ? (
          <>
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {payments_confirmed} rent payment{payments_confirmed === 1 ? "" : "s"} confirmed
          </>
        ) : null}
      </>
    );
  }, [passport]);

  const failed = Boolean(error) && !passport;

  return (
    <div className="ws-page passport-workspace">
      <WorkspaceHead
        icon="passport"
        title="Housing Passport"
        summary={summary}
        actions={passport ? (
          <button type="button" className="ws-action is-primary" aria-haspopup="dialog" onClick={() => setSharing(true)}>
            <Icon name="share" />Share passport
          </button>
        ) : null}
      />

      {failed ? (
        <section className="ws-panel">
          <PanelState
            tone="error"
            icon="warning"
            title="Your passport didn’t load"
            body={`${error} Check your connection and try again.`}
            action={<button type="button" className="ws-action" disabled={retrying} onClick={() => void retry()}>{retrying ? "Retrying…" : "Try again"}</button>}
          />
        </section>
      ) : !passport ? (
        <div className="passport-layout is-loading" aria-busy="true">
          <div className="passport-main">
            <div className="passport-cover is-loading" aria-label="Loading your passport" />
            <section className="passport-section"><PanelSkeleton rows={2} /></section>
          </div>
        </div>
      ) : (
        <div className="passport-layout">
          {/* Two columns from 64rem; below that the wrappers dissolve and the
              areas take the order a phone reads them in (passport.css). */}
          <div className="passport-main">
            <div className="passport-area-cover">
              <PassportCover view={passport} audience="owner" />
              {error ? (
                <div className="ws-inline-error" role="alert">
                  <Icon name="warning" /><span>{error}</span>
                  <button type="button" disabled={retrying} onClick={() => void retry()}>{retrying ? "Retrying…" : "Try again"}</button>
                </div>
              ) : null}
            </div>

            {/* Homes now in full; past homes as a ledger that opens in place. */}
            <HousingRecord
              className="passport-area-record"
              tenancies={passport.tenancies}
              actionFor={(tenancy) => <RecordAction tenancy={tenancy} corrections={passport.corrections} onReport={setReporting} />}
              empty={(
                <PanelState
                  icon="home"
                  title="No tenancies on Danpa HQ yet"
                  body="When you and a landlord accept a tenancy agreement here, it joins your passport with its rent record. Nothing missing counts against you."
                  action={<Link href="/rentals" className="ws-action is-primary"><Icon name="explore" />Explore rentals</Link>}
                />
              )}
            />

            {passport.identity ? (
              <div className="passport-area-identity">
                <IdentitySection
                  identity={passport.identity}
                  action={<IdentityAction corrections={passport.corrections} onReport={setReporting} />}
                />
              </div>
            ) : null}
          </div>

          <div className="passport-side">
            <div className="passport-area-links">
              <SharedLinks shares={shares} error={sharesError} onShare={() => setSharing(true)} onChanged={replaceShare} />
            </div>
            <div className="passport-area-timeline">
              <Timeline events={passport.timeline} />
            </div>
            <div className="passport-area-legend">
              <StatusLegend />
              <NotRecorded view={passport} audience="owner" />
            </div>
          </div>
        </div>
      )}

      {passport ? (
        <ShareFlow open={sharing} passport={passport} onClose={() => setSharing(false)} onCreated={replaceShare} />
      ) : null}
      <CorrectionSheet target={reporting} onClose={() => setReporting(null)} onReported={reported} />
    </div>
  );
}

/** Report a problem, or — once reported — where the review stands. */
function RecordAction({
  tenancy,
  corrections,
  onReport,
}: {
  tenancy: PassportTenancy;
  corrections: PassportCorrection[];
  onReport: (target: CorrectionTarget) => void;
}) {
  const open = [correctionFor(corrections, "tenancy", tenancy.id), correctionFor(corrections, "payments", tenancy.id)]
    .filter((row): row is PassportCorrection => row?.state === "under_review");
  const label = `${tenancy.place.title}${tenancy.place.space ? ` · ${tenancy.place.space}` : ""}`;
  return (
    <>
      {open.length ? <ReviewLink since={open[0]!.reported_on} /> : null}
      {open.length < 2 ? (
        <button
          type="button"
          className="passport-report"
          aria-haspopup="dialog"
          onClick={() => onReport({ kind: "tenancy", tenancyId: tenancy.id, label, hasPayments: Boolean(tenancy.payments?.confirmed) })}
        >
          <Icon name="warning" />Report a problem
        </button>
      ) : null}
    </>
  );
}

function IdentityAction({ corrections, onReport }: { corrections: PassportCorrection[]; onReport: (target: CorrectionTarget) => void }) {
  const open = correctionFor(corrections, "identity");
  if (open?.state === "under_review") return <ReviewLink since={open.reported_on} />;
  return (
    <button type="button" className="passport-report" aria-haspopup="dialog" onClick={() => onReport({ kind: "identity" })}>
      <Icon name="warning" />Report a problem
    </button>
  );
}

function ReviewLink({ since }: { since: string }) {
  return (
    <button type="button" className="passport-review-link" aria-haspopup="dialog" onClick={() => openEnquiries()}>
      <Icon name="clock" />Review requested {dayMonthYear(since)} · Follow in Support
    </button>
  );
}
