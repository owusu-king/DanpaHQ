import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Image, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { AuthPrompt } from "@/components/AuthPrompt";
import { Group, QuietLink, Row } from "@/components/account/IndexRows";
import { Notice, Type, space } from "@/components/ui";
import { resolveEntryRoute } from "@/navigation";
import { resolvePhotoUrl } from "@/photo";
import { theme } from "@/theme";
import { chooseWorkspace } from "@/workspace";

/**
 * The tenant's index: who you are, what you have done, and everything else.
 *
 * The provider's equivalent is More. They list different things — a tenant has
 * no Team and no Archive — but they are built from the same rows now. There was
 * a separate Settings screen sitting between this tab and its own account
 * destinations; it listed most of the same rows a second time and had to be kept
 * in step by hand, so it is gone.
 */
export default function ProfileTab() {
  const router = useRouter();
  const { state, refreshMe, signOut } = useAuth();
  const [switching, setSwitching] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const avatarEndpoint = state.status === "signed_in" ? state.me.profile?.avatar_url ?? null : null;
  useEffect(() => {
    let live = true;
    setPhotoUri(null);
    if (!avatarEndpoint) return;
    // Guarded: the photo may change before this resolves, and writing a stale
    // URL would flash the previous picture.
    void resolvePhotoUrl(avatarEndpoint).then((url) => { if (live) setPhotoUri(url); });
    return () => { live = false; };
  }, [avatarEndpoint]);

  if (state.status !== "signed_in") {
    return (
      <AuthPrompt
        title="Your profile"
        body="Continue with phone to manage your identity, notifications and account security."
        next="/(app)/(tabs)/profile"
      />
    );
  }

  const me = state.me;

  async function switchToProvider() {
    setSwitching(true);
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
    <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[6] }}>
      <View style={{ alignItems: "center", gap: space[2] }}>
        <Mark name={me.display_name} photoUri={photoUri} />
        <Type variant="display2" accessibilityRole="header">{me.display_name}</Type>
        <Type variant="caption" style={{ fontFamily: "monospace" }}>{me.phone_display}</Type>
      </View>

      {error ? <Notice tone="error" title={error} /> : null}

      {/* Saved leads its own group now that it is no longer a tab. It is a
          shortlist somebody returns to, not a record of something that already
          happened, and burying it under "Your history" made it the third row of
          a group it never belonged to. Explore's header reaches the same place
          for anyone already browsing. */}
      <Group title="Your shortlist">
        <Row icon="bookmark-outline" label="Saved places" onPress={() => router.push("/(app)/(tabs)/saved" as never)} />
      </Group>

      <Group title="Your history">
        <Row icon="document-text-outline" label="Applications" onPress={() => router.push("/(app)/applications" as never)} />
        <Row icon="calendar-outline" label="Viewings" onPress={() => router.push("/(app)/viewings" as never)} />
        <Row icon="document-outline" label="Agreements" onPress={() => router.push("/(app)/leases" as never)} />
      </Group>

      <Group title="Account and settings">
        <Row icon="person-outline" label="Profile" onPress={() => router.push("/(app)/profile-edit" as never)} />
        <Row icon="lock-closed-outline" label="Security" onPress={() => router.push("/(app)/security" as never)} />
        <Row icon="options-outline" label="Notifications" onPress={() => router.push("/(app)/notification-settings" as never)} />
        <Row icon="shield-checkmark-outline" label="Verification" onPress={() => router.push("/(app)/trust" as never)} />
      </Group>

      <View style={{ gap: space[1] }}>
        {/* Offered only to an account that actually holds provider capability.
            A change of view, not of account, so it is a link. */}
        {me.capabilities.available_workspaces.includes("provider") ? (
          <QuietLink
            label="Switch to managing property →"
            busyLabel="Switching…"
            busy={switching}
            onPress={() => void switchToProvider()}
          />
        ) : null}
        <QuietLink
          label="Sign out"
          busyLabel="Signing out…"
          busy={leaving}
          tone="quiet"
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
      </View>
    </ScrollView>
  );
}

/** Initials rather than a silhouette: a stranger's outline says less than a name. */
function Mark({ name, photoUri }: { name: string; photoUri: string | null }) {
  const initials = (name || "")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";

  if (photoUri) {
    return (
      <Image
        source={{ uri: photoUri }}
        style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: theme.color.field["100"] }}
      />
    );
  }
  return (
    <View
      style={{
        width: 88, height: 88, borderRadius: 44,
        alignItems: "center", justifyContent: "center",
        backgroundColor: theme.color.kola["600"],
      }}
    >
      <Type variant="title1" style={{ color: theme.color.field["0"] }}>{initials}</Type>
    </View>
  );
}
