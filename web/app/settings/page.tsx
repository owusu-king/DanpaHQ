"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { PhotoSection, ProfileSection } from "@/components/account/AccountSections";
import { BusinessSection, EmailSection, TenantDetailsSection } from "@/components/account/ProfileDetails";
import { Icon } from "@/components/portal/icons";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { listMyPortfolioInvitations } from "@/lib/console";
import { useSession } from "@/lib/session";

export default function ProfileSettingsPage() {
  const { state, refresh } = useSession();
  // Someone invited into a Portfolio may not be a provider yet, so this cannot
  // live behind a provider-only panel. It appears only when one is waiting and
  // disappears again once answered — a permanent menu item for a rare event was
  // the noise that put it in the account menu in the first place.
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    void listMyPortfolioInvitations()
      .then((rows) => setWaiting(rows.filter((row) => row.status === "pending").length))
      .catch(() => setWaiting(0));
  }, []);

  if (state.status !== "signed_in") {
    return (
      <SettingsCard title="Profile">
        <div className="prefs-skeleton" aria-busy="true" aria-label="Loading your profile">
          {Array.from({ length: 3 }).map((_, index) => <span key={index} className="ws-skeleton-block" />)}
        </div>
      </SettingsCard>
    );
  }
  const me = state.me;

  return (
    <>
      {waiting ? (
        <Link href={"/portfolio-invitations" as never} className="settings-invite">
          <span className="settings-invite-mark" aria-hidden="true"><Icon name="users" /></span>
          <span className="settings-invite-text">
            <strong>{waiting} Portfolio {waiting === 1 ? "invitation" : "invitations"} waiting for you</strong>
            <small>Someone has invited you into their property business. Nothing is granted until you accept.</small>
          </span>
          <span className="settings-invite-go">Review {waiting === 1 ? "it" : "them"}<Icon name="chevron-down" /></span>
        </Link>
      ) : null}

      <SettingsCard title="Photo" description="Shown to landlords, agents and your team. Initials are used until you add one.">
        <PhotoSection name={me.display_name} photoUrl={me.profile?.avatar_url ?? null} onSaved={refresh} />
      </SettingsCard>

      <SettingsCard title="Your details" description={<><span className="settings-mono">{me.phone_display}</span> · the number you sign in with</>}>
        <ProfileSection
          initial={{
            first_name: me.first_name,
            last_name: me.last_name,
            preferred_name: me.preferred_name,
            date_of_birth: me.date_of_birth ?? null,
            bio: me.profile?.bio ?? "",
          }}
          onSaved={refresh}
        />
      </SettingsCard>

      {/* An address joins the account only through its code (owner, 2026-10-07). */}
      <SettingsCard title="Email" description="Confirmed with a six-digit code sent to the address.">
        <EmailSection current={me.email} verified={Boolean(me.is_email_verified)} onChanged={refresh} />
      </SettingsCard>

      {/* Each part is drawn only for a role this account holds: the API refuses
          the others, and asking a tenant for a company number is noise. */}
      {me.roles.includes("tenant") ? (
        <SettingsCard title="For your applications" description="Helps a provider read your application. Leave anything you would rather not say.">
          <TenantDetailsSection />
        </SettingsCard>
      ) : null}

      {me.roles.includes("landlord") ? (
        <SettingsCard title="Your business" description="If you let property through a registered company.">
          <BusinessSection />
        </SettingsCard>
      ) : null}
    </>
  );
}
