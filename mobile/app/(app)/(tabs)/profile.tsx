import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { AuthPrompt } from "@/components/AuthPrompt";
import {
  Group,
  IndexActions,
  IndexPage,
  Row,
  SignOutButton,
  SwitchExperienceButton,
} from "@/components/account/IndexRows";
import { Notice } from "@/components/ui";
import { resolveEntryRoute } from "@/navigation";
import { listMyPortfolioInvitations } from "@/organizations";
import { chooseWorkspace } from "@/workspace";

/**
 * The tenant's More: everything that is not a tab, in groups.
 *
 * A hub, not a profile. It used to open with a photo, a display-size name and a
 * phone number, under a header that said "Profile" while the tab said "More", so
 * the fifth tab read as a page about the person rather than the way to everything
 * else. Who you are is behind the Profile row now, where it can be changed, and
 * the page opens with its sections.
 *
 * The provider's equivalent is their More. They list different things — a tenant
 * has no Team and no Archive — but they are built from the same page, groups, rows
 * and acts. There was a separate Settings screen sitting between this tab and its
 * own account destinations; it listed most of the same rows a second time and had
 * to be kept in step by hand, so it is gone.
 */
export default function ProfileTab() {
  const router = useRouter();
  const { state, refreshMe, signOut } = useAuth();
  const [switching, setSwitching] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");

  // Somebody invited into a Portfolio may not be a provider at all, so the way
  // in cannot sit behind a provider-only screen. It appears only while an
  // invitation is waiting — a permanent row for a rare event is the noise that
  // buried it — and on focus, so answering one clears it on the way back.
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
        title="Your account"
        body="Continue with phone to manage your identity, notifications and account security."
        next="/(app)/(tabs)/profile"
      />
    );
  }

  const me = state.me;

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

  return (
    <IndexPage>
      {invitationsWaiting ? (
        <Group title="Waiting for you" tone="harmattan">
          <Row
            icon="people-circle-outline"
            label="Portfolio invitations"
            count={invitationsWaiting}
            onPress={() => router.push("/(app)/portfolio-invitations" as never)}
          />
        </Group>
      ) : null}

      {/* Saved leads its own group now that it is no longer a tab. It is a
          shortlist somebody returns to, not a record of something that already
          happened, and burying it under "Your history" made it the third row of
          a group it never belonged to. Explore's header reaches the same place
          for anyone already browsing. */}
      <Group title="Your shortlist" tone="laterite">
        <Row icon="bookmark-outline" label="Saved places" onPress={() => router.push("/(app)/saved" as never)} />
      </Group>

      <Group title="Your history" tone="lagoon">
        <Row icon="document-text-outline" label="Applications" onPress={() => router.push("/(app)/applications" as never)} />
        <Row icon="calendar-outline" label="Viewings" onPress={() => router.push("/(app)/viewings" as never)} />
        <Row icon="document-outline" label="Agreements" onPress={() => router.push("/(app)/leases" as never)} />
      </Group>

      <Group title="Account and settings" tone="kola">
        <Row icon="person-outline" label="Profile" onPress={() => router.push("/(app)/profile-edit" as never)} />
        <Row icon="lock-closed-outline" label="Security" onPress={() => router.push("/(app)/security" as never)} />
        <Row icon="options-outline" label="Notifications" onPress={() => router.push("/(app)/notification-settings" as never)} />
        <Row icon="shield-checkmark-outline" label="Verification" onPress={() => router.push("/(app)/trust" as never)} />
      </Group>

      {/* A switch that fails says so beside the switch. At the top of the page
          it was out of sight of the thumb that had just pressed it. */}
      {error ? <Notice tone="error" title={error} /> : null}
      <IndexActions>
        {/* Offered only to an account that actually holds provider capability.
            A change of view, not of account. */}
        {me.capabilities.available_workspaces.includes("provider") ? (
          <SwitchExperienceButton
            label="Switch to managing property"
            busyLabel="Switching…"
            busy={switching}
            onPress={() => void switchToProvider()}
          />
        ) : null}
        <SignOutButton
          label="Sign out"
          busyLabel="Signing out…"
          busy={leaving}
          onPress={async () => {
            setLeaving(true);
            try {
              await signOut();
              router.replace("/(auth)/welcome");
            } finally {
              setLeaving(false);
            }
          }}
        />
      </IndexActions>
    </IndexPage>
  );
}
