"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

import { ApplicationForm } from "@/components/artisan/ApplicationForm";
import { ArtisanFacts } from "@/components/artisan/ArtisanFacts";
import { WorkList } from "@/components/artisan/ArtisanWork";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { PanelSkeleton, PanelState, WorkspaceHead } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import {
  getMyArtisanApplication,
  listMyInvitations,
  listMyJobs,
  type ArtisanApplication,
  type ArtisanInvitation,
} from "@/lib/artisan";
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
  return { application, error, setApplication };
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
  const { rows: invitations } = useWork(listMyInvitations);
  const { rows: jobs } = useWork(listMyJobs);
  const newInvites = invitations?.filter((row) => row.state === "invited") ?? [];
  const activeJobs = jobs?.filter((row) => row.request.status !== "completed") ?? [];

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
          {invitations === null ? <PanelSkeleton rows={2} /> : newInvites.length ? (
            <HomeCount count={newInvites.length} label={newInvites.length === 1 ? "invitation waiting for your quote" : "invitations waiting for your quote"} href="/artisan/requests" />
          ) : (
            <PanelState icon="receipt" title="No invitations yet" body="When a tenant or property provider asks you to quote, it appears here." />
          )}
        </section>

        <section className="ws-panel art-home-panel" aria-labelledby="art-home-jobs">
          <header className="art-home-panel-head">
            <span className="art-home-panel-icon is-kola" aria-hidden="true"><Icon name="wrench" /></span>
            <h2 id="art-home-jobs">Active jobs</h2>
            <Link href={"/artisan/jobs" as never}>Jobs</Link>
          </header>
          {jobs === null ? <PanelSkeleton rows={2} /> : activeJobs.length ? (
            <HomeCount count={activeJobs.length} label={activeJobs.length === 1 ? "job under way" : "jobs under way"} href="/artisan/jobs" />
          ) : (
            <PanelState icon="wrench" title="No active jobs" body="A job starts here once a customer approves your quote." />
          )}
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
  const { rows, reload } = useWork(listMyInvitations);
  const waiting = rows?.filter((row) => row.state === "invited").length ?? 0;
  return (
    <ArtisanOnly>
      {(me) => (
        <div className="ws-page">
          <WorkspaceHead
            icon="receipt"
            title="Requests"
            summary={rows === null ? null : waiting ? <><strong>{waiting} waiting for your quote</strong></> : "Quote invitations, and the quotes you send in reply."}
          />
          <SuspendedNotice me={me} />
          <WorkList
            rows={rows}
            onChanged={reload}
            empty={{ icon: "receipt", title: "No quote invitations yet", body: "You see the area and the problem. The address opens only if your quote is approved." }}
          />
        </div>
      )}
    </ArtisanOnly>
  );
}

export function ArtisanJobsPage() {
  const { rows, reload } = useWork(listMyJobs);
  return (
    <ArtisanOnly>
      {(me) => (
        <div className="ws-page">
          <WorkspaceHead icon="wrench" title="Jobs" summary="Work a customer approved, with the address, contact and history." />
          <SuspendedNotice me={me} />
          <WorkList
            rows={rows}
            onChanged={reload}
            empty={{ icon: "wrench", title: "No jobs yet", body: "A job appears here once a customer approves your quote." }}
          />
        </div>
      )}
    </ArtisanOnly>
  );
}

function useWork(load: () => Promise<ArtisanInvitation[]>) {
  const [rows, setRows] = useState<ArtisanInvitation[] | null>(null);
  const reload = useCallback(async () => {
    try {
      setRows(await load());
    } catch {
      setRows((current) => current ?? []);
    }
  }, [load]);
  useEffect(() => { void reload(); }, [reload]);
  return { rows, reload };
}

function HomeCount({ count, label, href }: { count: number; label: string; href: string }) {
  return (
    <Link href={href as never} className="art-home-count">
      <strong>{count}</strong>
      <span>{label}</span>
      <Icon name="chevron-down" />
    </Link>
  );
}

export function ArtisanProfilePage() {
  const { application, error, setApplication } = useArtisanApplication();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <ArtisanOnly>
      {(me) => (
        <div className="ws-page">
          <WorkspaceHead
            icon="hammer"
            title="My Profile"
            summary="What customers will see about you: facts, not ratings."
            actions={application?.profile && !editing ? (
              <button type="button" className="ws-action is-primary" onClick={() => { setEditing(true); setSaved(false); }}>
                <Icon name="pencil" />
                Edit profile
              </button>
            ) : editing ? (
              <button type="button" className="ws-action" onClick={() => setEditing(false)}>Cancel</button>
            ) : null}
          />
          <SuspendedNotice me={me} />
          {error ? <Notice tone="error" title={error} /> : null}
          {saved ? <Notice tone="success" title="Profile saved" body="Customers see the change now. New certificates show as provided until our team checks them." /> : null}
          {application && editing ? (
            <ApplicationForm
              application={application}
              mode="edit"
              onSent={(next) => {
                setApplication(next);
                setEditing(false);
                setSaved(true);
                window.scrollTo({ top: 0 });
              }}
            />
          ) : application ? (
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
