"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { ArtisanFacts } from "@/components/artisan/ArtisanFacts";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { PanelSkeleton, PanelState, WorkspaceHead } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import { getMyArtisanApplication, type ArtisanApplication } from "@/lib/artisan";
import { useSession, type Me } from "@/lib/session";

/**
 * The artisan experience on web: Home, Requests, Jobs and My Profile.
 *
 * An artisan sees the work they were invited to or given and nothing beyond it
 * — no tenants, no properties, no maintenance they are not part of. The pages
 * render only once the backend says the experience is open; a hidden page is a
 * courtesy, and every request behind it is refused on its own.
 */

function useArtisanApplication() {
  const [application, setApplication] = useState<ArtisanApplication | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    getMyArtisanApplication()
      .then((next) => { if (live) setApplication(next); })
      .catch((cause) => { if (live) setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your artisan profile."); });
    return () => { live = false; };
  }, []);
  return { application, error };
}

/** Pages behind the artisan experience render only inside it. */
function ArtisanOnly({ children }: { children: (me: Me) => ReactNode }) {
  const { state } = useSession();
  if (state.status !== "signed_in") return null;
  const me = state.me;
  if (me.capabilities.active_workspace !== "artisan" || !me.capabilities.artisan.workspace_access) {
    return (
      <div className="ws-page">
        <PanelState
          icon="hammer"
          title="This is part of the artisan experience"
          body="It opens once your artisan application is approved and you switch to it from your account menu."
          action={<Link href={"/artisan" as never} className="btn btn-secondary">See your application</Link>}
        />
      </div>
    );
  }
  return <>{children(me)}</>;
}

/** Shown on every artisan page while Management has paused new work. */
function SuspendedNotice({ me }: { me: Me }) {
  if (me.capabilities.artisan.can_quote) return null;
  return (
    <Notice
      tone="warning"
      title="Your artisan account is suspended"
      body="You cannot send new quotes or take on new jobs for now. Everything you have already done stays here. See your application for the reason."
    />
  );
}

export function ArtisanHome({ me }: { me: Me }) {
  const { application, error } = useArtisanApplication();
  const firstName = me.display_name.split(/\s+/)[0] ?? me.display_name;
  const profile = application?.profile;

  return (
    <div className="ws-page art-home">
      <section className="art-home-hero" aria-labelledby="art-home-title">
        <span className="art-home-eyebrow">Artisan</span>
        <h1 id="art-home-title">Good to see you, {firstName}</h1>
        <p>
          {profile
            ? `${profile.trades.map((trade) => trade.label).join(", ")} · ${profile.districts.map((district) => district.name).join(", ")}`
            : "Quote invitations, jobs and what needs you, in one place."}
        </p>
        <span className="art-hero-mark" aria-hidden="true"><Icon name="hammer" /></span>
      </section>

      <SuspendedNotice me={me} />
      {error ? <Notice tone="error" title={error} /> : null}

      <div className="art-home-grid">
        <section className="ws-panel art-home-panel" aria-labelledby="art-home-invites">
          <header className="art-home-panel-head">
            <span className="art-home-panel-icon is-harmattan" aria-hidden="true"><Icon name="receipt" /></span>
            <h2 id="art-home-invites">New quote invitations</h2>
            <Link href={"/artisan/requests" as never}>Requests</Link>
          </header>
          <PanelState
            icon="receipt"
            title="No invitations yet"
            body="When a tenant or property provider asks you to quote, it appears here with the area and what needs doing."
          />
        </section>

        <section className="ws-panel art-home-panel" aria-labelledby="art-home-jobs">
          <header className="art-home-panel-head">
            <span className="art-home-panel-icon is-kola" aria-hidden="true"><Icon name="wrench" /></span>
            <h2 id="art-home-jobs">Active jobs</h2>
            <Link href={"/artisan/jobs" as never}>Jobs</Link>
          </header>
          <PanelState
            icon="wrench"
            title="No active jobs"
            body="A job starts here once a customer approves your quote."
          />
        </section>
      </div>

      <section className="ws-panel art-home-panel" aria-labelledby="art-home-profile">
        <header className="art-home-panel-head">
          <span className="art-home-panel-icon is-lagoon" aria-hidden="true"><Icon name="hammer" /></span>
          <h2 id="art-home-profile">Your profile</h2>
          <Link href={"/artisan/profile" as never}>My Profile</Link>
        </header>
        {profile ? (
          <ArtisanFacts profile={profile} />
        ) : application ? null : (
          <PanelSkeleton rows={2} />
        )}
      </section>
    </div>
  );
}

export function ArtisanRequestsPage() {
  return (
    <ArtisanOnly>
      {(me) => (
        <div className="ws-page">
          <WorkspaceHead icon="receipt" title="Requests" summary="Quote invitations, and the quotes you send in reply." />
          <SuspendedNotice me={me} />
          <section className="ws-panel" aria-label="Quote invitations">
            <PanelState
              icon="receipt"
              title="No quote invitations yet"
              body="A tenant or property provider invites you to quote. You see the area and what needs doing; the exact address and a contact open only after your quote is approved."
            />
          </section>
        </div>
      )}
    </ArtisanOnly>
  );
}

export function ArtisanJobsPage() {
  return (
    <ArtisanOnly>
      {(me) => (
        <div className="ws-page">
          <WorkspaceHead icon="wrench" title="Jobs" summary="Work a customer approved, its photos and its history." />
          <SuspendedNotice me={me} />
          <section className="ws-panel" aria-label="Jobs">
            <PanelState
              icon="wrench"
              title="No jobs yet"
              body="A job appears here once a customer approves your quote. Its photos, cost and history stay here after it is finished."
            />
          </section>
        </div>
      )}
    </ArtisanOnly>
  );
}

export function ArtisanProfilePage() {
  const { application, error } = useArtisanApplication();
  return (
    <ArtisanOnly>
      {(me) => (
        <div className="ws-page">
          <WorkspaceHead icon="hammer" title="My Profile" summary="What customers will see about you: facts, not ratings." />
          <SuspendedNotice me={me} />
          {error ? <Notice tone="error" title={error} /> : null}
          {application ? (
            <>
              <ul className="art-profile-facts" aria-label="On record">
                <li>
                  <span className="art-profile-fact-icon is-kola" aria-hidden="true"><Icon name="shield" /></span>
                  <span>
                    <strong>{application.identity_on_file ? "ID checked" : "ID not checked"}</strong>
                    <small>By Danpa HQ&apos;s review team</small>
                  </span>
                </li>
                <li>
                  <span className="art-profile-fact-icon is-harmattan" aria-hidden="true"><Icon name="wrench" /></span>
                  <span>
                    <strong>0 jobs</strong>
                    <small>Completed on Danpa HQ</small>
                  </span>
                </li>
                <li>
                  <span className="art-profile-fact-icon is-lagoon" aria-hidden="true"><Icon name="star" /></span>
                  <span>
                    <strong>No reviews yet</strong>
                    <small>From customers after a confirmed job</small>
                  </span>
                </li>
              </ul>
              {application.profile ? (
                <section className="ws-panel art-profile-panel">
                  <ArtisanFacts profile={application.profile} />
                </section>
              ) : null}
            </>
          ) : error ? null : (
            <PanelSkeleton rows={3} />
          )}
        </div>
      )}
    </ArtisanOnly>
  );
}
