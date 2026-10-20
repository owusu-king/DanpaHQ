"use client";

import { AlertCircle, CircleCheck, Hammer, PauseCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ApplicationForm } from "@/components/artisan/ApplicationForm";
import { ArtisanFacts } from "@/components/artisan/ArtisanFacts";
import { VerificationTrack, type TrackStop } from "@/components/auth/VerificationTrack";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
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
 * Reached from the account menu in whichever experience somebody is in, and it
 * leaves them there: nothing on this page switches experience except the one
 * button an approved artisan presses themselves. Every state is read from the
 * backend; the page never decides for itself that the experience is open.
 */
function stops(status: ArtisanStatus): TrackStop[] {
  const sent = status !== "not_started";
  const refused = ["needs_more_info", "rejected", "revoked"].includes(status);
  const open = status === "approved" || status === "suspended";
  return [
    {
      state: refused ? "attention" : sent ? "done" : "next",
      label: refused ? "Update your application" : "Apply",
      detail: refused ? "Read the note from the review" : "Trades, area and photos of your work",
    },
    {
      state: open ? "done" : status === "pending" ? "waiting" : "later",
      label: status === "pending" ? "Under review" : "We review it",
      detail: status === "pending" ? "We will let you know the outcome" : "Your account carries on as it is meanwhile",
    },
    {
      state: open ? "done" : "later",
      label: "The artisan experience opens",
      detail: "Quote requests, jobs and your profile, in their own place",
    },
  ];
}

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
  const PillIcon = status === "approved" ? CircleCheck : status === "suspended" ? PauseCircle : status === "pending" ? null : status === "not_started" ? Hammer : AlertCircle;

  return (
    <div className="pv art">
      <header className="pv-hero art-hero">
        {application ? (
          <span className={`pv-pill ${look.tone}`}>
            {PillIcon ? <PillIcon aria-hidden="true" /> : <span className="pv-pulse" aria-hidden="true" />}
            {look.pill}
          </span>
        ) : null}
        <h1>{application ? look.title : "Work as an artisan"}</h1>
        <p>{application ? look.line : "Checking where your application stands…"}</p>
        <span className="art-hero-mark" aria-hidden="true"><Hammer /></span>
      </header>

      {error ? <Notice tone="error" title={error} /> : null}

      {application ? (
        <>
          <div className="pv-grid art-grid">
            <section className="pv-card" aria-labelledby="art-where">
              <h2 id="art-where">Where you are</h2>
              {justSent && status === "pending" ? (
                <div className="pv-sent" role="status">
                  <div className="auth-success" aria-hidden="true">
                    <span className="auth-success-ring" />
                    <span className="auth-success-disc"><CircleCheck /></span>
                  </div>
                  <strong>Application sent</strong>
                  <small>It is with our team. Your account carries on exactly as it was meanwhile.</small>
                </div>
              ) : null}
              {application.decision_note ? (
                <Notice
                  tone={status === "needs_more_info" ? "warning" : "error"}
                  title="From the review"
                  body={application.decision_note}
                />
              ) : null}
              {status === "suspended" && application.suspended_reason ? (
                <Notice tone="warning" title="Why your account is suspended" body={application.suspended_reason} />
              ) : null}
              <VerificationTrack stops={stops(status)} />
              {(application.status === "approved" || application.status === "suspended")
                && !(state.status === "signed_in" && state.me.capabilities.active_workspace === "artisan") ? (
                <Button onClick={() => void enter()} busy={switching} busyLabel="Opening…">
                  Switch to artisan experience
                </Button>
              ) : null}
            </section>

            <section className="pv-card art-how" aria-labelledby="art-how">
              <h2 id="art-how">How it works</h2>
              <ol className="art-how-list">
                <li>
                  <strong>Tenants and property providers invite you to quote</strong>
                  <span>You see the area and what needs doing. The exact address and a contact open only once your quote is approved.</span>
                </li>
                <li>
                  <strong>You send a price and what it covers</strong>
                  <span>If the job turns out bigger, you send a revised quote and wait for it to be approved first.</span>
                </li>
                <li>
                  <strong>The work is recorded</strong>
                  <span>Photos when you finish, the customer confirms, and the job joins your record on Danpa HQ.</span>
                </li>
              </ol>
            </section>
          </div>

          {canSendApplication(status) ? (
            <ApplicationForm
              application={application}
              onSent={(next) => {
                setApplication(next);
                setJustSent(true);
                void refresh();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          ) : application.profile ? (
            <section className="pv-card" aria-labelledby="art-sent">
              <h2 id="art-sent">What you sent</h2>
              <ArtisanFacts profile={application.profile} />
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
