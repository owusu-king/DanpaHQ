"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { PhotoSection, ProfileSection } from "@/components/account/AccountSections";
import { Notice } from "@/components/Notice";
import { LoadingRows } from "@/components/portal/PageHeader";
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

  if (state.status !== "signed_in") return <LoadingRows rows={3} />;
  const me = state.me;

  return (
    <>
      {waiting ? (
        <section className="settings-section">
          <Notice
            tone="info"
            title={`${waiting} Portfolio ${waiting === 1 ? "invitation" : "invitations"} waiting for you`}
            body="Someone has invited you into their property business. Nothing is granted until you accept."
          />
          <p>
            <Link href={"/portfolio-invitations" as never} className="type-body-strong">
              Review {waiting === 1 ? "it" : "them"} →
            </Link>
          </p>
        </section>
      ) : null}
      <section className="settings-section">
        <h2>Photo</h2>
        <PhotoSection name={me.display_name} photoUrl={me.profile?.avatar_url ?? null} onSaved={refresh} />
      </section>

      <section className="settings-section">
        <h2>Your details</h2>
        <p className="type-caption">{me.phone_display} · used to sign in</p>
        <ProfileSection
          initial={{
            first_name: me.first_name,
            last_name: me.last_name,
            preferred_name: me.preferred_name,
            email: me.email ?? "",
          }}
          onSaved={refresh}
        />
      </section>
    </>
  );
}
