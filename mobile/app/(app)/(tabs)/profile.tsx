import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { AuthPrompt } from "@/components/AuthPrompt";
import { Identity, YouPage, type YouSection } from "@/components/account/YouParts";
import { useProfilePhoto } from "@/components/nav/TabHeaderControls";
import { Notice } from "@/components/ui";
import { resolveEntryRoute } from "@/navigation";
import { listMyPortfolioInvitations } from "@/organizations";
import { chooseWorkspace } from "@/workspace";

/**
 * The tenant's More, laid out like WhatsApp's "You" tab (owner, 2026-10-06):
 * the person first, then everything that is not a tab in untitled white cards.
 *
 * The photo, the name and the pencil all open the profile, so there is no
 * Profile row. The cards group by what they are for — what you are looking at
 * and have asked for; how the account is kept; and leaving — without naming the
 * groups, because a card of six rows that says what it holds needs no heading.
 *
 * The provider's equivalent is their More, built from the same parts. There was
 * once a separate Settings screen listing most of these a second time; it is
 * gone, and stays gone.
 */
export default function ProfileTab() {
  const router = useRouter();
  const { state, refreshMe, signOut } = useAuth();
  const photoUri = useProfilePhoto();
  const [switching, setSwitching] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");

  // Somebody invited into a Portfolio may not be a provider at all, so the way
  // in cannot sit behind a provider-only screen. It appears only while an
  // invitation is waiting, and on focus, so answering one clears it on the way back.
  const [invitationsWaiting, setInvitationsWaiting] = useState(0);
  useFocusEffect(
    useCallback(() => {
      void listMyPortfolioInvitations()
        .then((rows) => setInvitationsWaiting(rows.filter((row) => row.status === "pending").length))
        .catch(() => setInvitationsWaiting(0));
    }, []),
  );

  if (state.status !== "signed_in") {
    return (
      <AuthPrompt
        icon="list"
        tone="lagoon"
        title="Everything else"
        body="Your shortlist, your applications and viewings, and the account behind them."
        next="/(app)/(tabs)/profile"
        points={[
          { icon: "bookmark-outline", label: "Saved places, on every device" },
          { icon: "calendar-outline", label: "Applications, viewings and agreements" },
          { icon: "lock-closed-outline", label: "Security and what we may send you" },
        ]}
      />
    );
  }

  const me = state.me;
  const go = (path: string) => () => router.push(path as never);
  const unfinished = (me.profile?.completeness ?? 0) < 100;

  async function switchToProvider() {
    setSwitching(true);
    setError("");
    try {
      const next = await chooseWorkspace("provider");
      await refreshMe();
      router.replace(resolveEntryRoute(next) as never);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not switch.");
    } finally {
      setSwitching(false);
    }
  }

  async function leave() {
    setLeaving(true);
    try {
      await signOut();
      router.replace("/(auth)/start");
    } finally {
      setLeaving(false);
    }
  }

  const sections: YouSection[] = [
    {
      key: "waiting",
      items: invitationsWaiting
        ? [{ key: "invitations", icon: "people-circle-outline", label: "Portfolio invitations", count: invitationsWaiting, onPress: go("/(app)/portfolio-invitations") }]
        : [],
    },
    {
      key: "renting",
      items: [
        { key: "saved", icon: "bookmark-outline", label: "Saved places", onPress: go("/(app)/saved") },
        { key: "applications", icon: "document-text-outline", label: "Applications", onPress: go("/(app)/applications") },
        { key: "viewings", icon: "calendar-outline", label: "Viewings", onPress: go("/(app)/viewings") },
        { key: "agreements", icon: "document-outline", label: "Agreements", onPress: go("/(app)/leases") },
        // Properties you asked to buy: the conversations a sale starts.
        { key: "enquiries", icon: "chatbubbles-outline", label: "Enquiries", onPress: go("/(app)/enquiries") },
      ],
    },
    {
      key: "account",
      items: [
        { key: "security", icon: "key-outline", label: "Security", onPress: go("/(app)/security") },
        { key: "verification", icon: "shield-checkmark-outline", label: "Verification", onPress: go("/(app)/trust") },
        { key: "notifications", icon: "notifications-outline", label: "Notifications", onPress: go("/(app)/notification-settings") },
      ],
    },
    {
      key: "leave",
      items: [
        // Offered only to an account that actually holds provider capability.
        // A change of view, not of account.
        ...(me.capabilities.available_workspaces.includes("provider")
          ? [{ key: "switch", icon: "swap-horizontal-outline" as const, label: "Switch to managing property", busy: switching, busyLabel: "Switching…", onPress: () => void switchToProvider() }]
          : []),
        { key: "sign-out", icon: "log-out-outline", label: "Sign out", danger: true, busy: leaving, busyLabel: "Signing out…", onPress: () => void leave() },
      ],
    },
  ];

  return (
    <YouPage
      tools={[
        { key: "join", icon: "key-outline", label: "Join your home with a code", onPress: go("/(app)/tenant-setup") },
        { key: "edit", icon: "pencil", label: "Edit your profile", onPress: go("/(app)/profile-edit") },
      ]}
      identity={
        <Identity
          name={me.display_name}
          photoUri={photoUri}
          note={unfinished ? "Finish your profile" : me.phone_display}
          verified={me.is_phone_verified}
          onPress={go("/(app)/profile-edit")}
        />
      }
      sections={sections}
      // A switch that fails says so beside the switch.
      notice={error ? <Notice tone="error" title={error} /> : null}
    />
  );
}
