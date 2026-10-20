"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ApplicationForm } from "@/components/artisan/ApplicationForm";
import { ArtisanFacts } from "@/components/artisan/ArtisanFacts";
import { VerificationTrack, type TrackStop } from "@/components/auth/VerificationTrack";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { PanelSkeleton, WorkspaceHead } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import {
  ARTISAN_STATUS_LOOK,
  canSendApplication,
  getMyArtisanApplication,
  type ArtisanApplication,
} from "@/lib/artisan";
import { resolveWebEntry } from "@/lib/navigation";
import { chooseWorkspace, useSession, type ArtisanStatus } from "@/lib/session";

/**
 * Becoming an artisan — the application, and where it stands.
 *
 * Reached from the Artisans sheet's quiet "Become an artisan?" link, never
 * pushed from a menu. It leaves people in the experience they were in: the only
 * switch is the button an approved artisan presses themselves. The page is the
 * shared workspace column — the form in the main column, where it stands and
 * how it works in the aside — and every state is read from the backend.
 */
function stops(status: ArtisanStatus): TrackStop[] {
  const sent = status !== "not_started";
  const refused = ["needs_more_info", "rejected", "revoked"].includes(status);
  const open = status === "approved" || status === "suspended";
  return [
    { state: refused ? "attention" : sent ? "done" : "next", label: refused ? "Update and resend" : "Apply" },
    { state: open ? "done" : status === "pending" ? "waiting" : "later", label: status === "pending" ? "Under review" : "Review" },
    { state: open ? "done" : "later", label: "Artisan experience opens" },
  ];
}

const HOW = [
  { icon: "receipt", text: "Customers invite you to quote. You see the area and the job." },
  { icon: "lock", text: "The address and a contact open once your quote is approved." },
  { icon: "wrench", text: "Finish, add photos, and the job joins your record." },
] as const;

export default function ArtisanApplicationPage() {
  const router = useRouter();
  const { state, refresh } = useSession();
  const [application, setApplication] = useState<ArtisanApplication | null>(null);
  const [error, setError] = useState("");
  const [justSent, setJustSent] = useState(false);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    try {
      setApplication(await getMyArtisanApplication());
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your application.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function enter() {
    setSwitching(true);
    try {
      const next = await chooseWorkspace("artisan");
      await refresh();
      router.push(resolveWebEntry(next) as never);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not open the artisan experience.");
      setSwitching(false);
    }
  }

  const status = application?.status ?? "not_started";
  const look = ARTISAN_STATUS_LOOK[status];
  const open = status === "approved" || status === "suspended";
  const inside = state.status === "signed_in" && state.me.capabilities.active_workspace === "artisan";

  return (
    <div className="ws-page art-apply">
      <WorkspaceHead
        icon="hammer"
        title={application ? look.title : "Become an artisan"}
        summary={application ? (
          <>
            <span className={`art-status ${look.tone}`}>{look.pill}</span>
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {look.line}
          </>
        ) : null}
        actions={open && !inside ? (
          <button type="button" className="ws-action is-primary" onClick={() => void enter()} disabled={switching}>
            <Icon name="hammer" />
            {switching ? "Opening…" : "Switch to artisan experience"}
          </button>
        ) : null}
      />

      {error ? <Notice tone="error" title={error} /> : null}

      <div className="art-apply-layout">
        <div className="art-apply-main">
          {justSent && status === "pending" ? (
            <Notice tone="success" title="Application sent" body="We'll let you know the outcome. Your account carries on as it was." />
          ) : null}
          {application?.decision_note ? (
            <Notice tone={status === "needs_more_info" ? "warning" : "error"} title="From the review" body={application.decision_note} />
          ) : null}
          {status === "suspended" && application?.suspended_reason ? (
            <Notice tone="warning" title="Why your account is suspended" body={application.suspended_reason} />
          ) : null}

          {!application && !error ? (
            <PanelSkeleton rows={4} />
          ) : application && canSendApplication(status) ? (
            <ApplicationForm
              application={application}
              onSent={(next) => {
                setApplication(next);
                setJustSent(true);
                void refresh();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          ) : application?.profile ? (
            <section className="ws-panel art-apply-sent" aria-labelledby="art-sent">
              <h2 id="art-sent">What you sent</h2>
              <ArtisanFacts profile={application.profile} />
            </section>
          ) : null}
        </div>

        <aside className="art-apply-aside" aria-label="About your application">
          <section className="art-aside-card">
            <h2>Where you are</h2>
            <VerificationTrack stops={stops(status)} />
          </section>
          <section className="art-aside-card">
            <h2>How it works</h2>
            <ul className="art-aside-list">
              {HOW.map((step) => (
                <li key={step.icon}>
                  <span className="art-aside-icon" aria-hidden="true"><Icon name={step.icon} /></span>
                  {step.text}
                </li>
              ))}
            </ul>
          </section>
          <section className="art-aside-card is-warm">
            <h2>Payments</h2>
            <p>Customers pay you directly. Danpa HQ keeps the record and never holds the money.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
