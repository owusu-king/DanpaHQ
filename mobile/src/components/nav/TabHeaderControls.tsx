import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { useAuth } from "@/auth";
import { HeaderActions, HeaderCircleButton } from "@/components/nav/HeaderCircleButton";
import { useUnreadUpdates } from "@/components/nav/useUnreadUpdates";
import { radius, space } from "@/components/ui";
import { resolvePhotoUrl } from "@/photo";
import { alpha, shell } from "@/shell";
import { theme } from "@/theme";

/** Below this width the search pill says less and the gaps close up. */
const NARROW_WIDTH = 360;
const AVATAR = 36;
const CREATE_DISC = 38;

/**
 * The controls in a tab's header, for each workspace.
 *
 * The header no longer names the page; the tab bar already does. It is a tool
 * row, in the same places on every tab:
 *
 * - **Tenant:** you (profile) on the leading side, a search pill in the middle,
 *   and the bell on the trailing side. Services and Payments add their help
 *   beside the bell, because their guides are written for those pages.
 * - **Landlord:** the Portfolio being operated on the leading side (see
 *   `PortfolioHeaderButton`), and the bell and the create action on the
 *   trailing side.
 */

export function useProfilePhoto(): string | null {
  const { state } = useAuth();
  // Kept with the endpoint it came from, so a changed photo never shows the
  // previous picture while the new one resolves.
  const [resolved, setResolved] = useState<{ endpoint: string; url: string | null } | null>(null);
  const endpoint = state.status === "signed_in" ? (state.me.profile?.avatar_url ?? null) : null;

  useEffect(() => {
    let live = true;
    if (!endpoint) return;
    // `resolvePhotoUrl` caches, so this is one request per session.
    void resolvePhotoUrl(endpoint).then((url) => {
      if (live) setResolved({ endpoint, url });
    });
    return () => {
      live = false;
    };
  }, [endpoint]);

  return endpoint && resolved?.endpoint === endpoint ? resolved.url : null;
}

function initialsOf(first: string, last: string, fallback: string): string {
  const letters = `${first.trim()[0] ?? ""}${last.trim()[0] ?? ""}`;
  return (letters || fallback.trim().slice(0, 2)).toUpperCase();
}

/** You: your photo, or your initials, in a ring on the green. */
export function TenantProfileButton() {
  const router = useRouter();
  const { state } = useAuth();
  const photoUri = useProfilePhoto();
  const me = state.status === "signed_in" ? state.me : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={me ? "Your profile" : "Sign in"}
      onPress={() => router.push((me ? "/(app)/profile-edit" : "/(auth)/sign-in") as never)}
      hitSlop={6}
      style={({ pressed }) => [styles.avatar, pressed ? styles.avatarPressed : null]}
    >
      {photoUri ? (
        <Image source={{ uri: photoUri }} accessible={false} style={styles.photo} />
      ) : me ? (
        <Text allowFontScaling={false} style={styles.initials}>
          {initialsOf(me.first_name, me.last_name, me.display_name)}
        </Text>
      ) : (
        <Ionicons name="person-outline" size={18} color={shell.onChrome} />
      )}
    </Pressable>
  );
}

/** The middle of the tenant's header: a way into search from any tab. */
export function HeaderSearchPill() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const narrow = width <= NARROW_WIDTH;

  return (
    <Pressable
      accessibilityRole="search"
      accessibilityLabel="Search homes"
      onPress={() => router.navigate("/(app)/(tabs)/explore" as never)}
      hitSlop={4}
      style={({ pressed }) => [styles.pill, pressed ? styles.pillPressed : null]}
    >
      <View style={styles.pillGlyph}>
        <Ionicons name="search" size={13} color={shell.chrome} />
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={styles.pillLabel}>
        {narrow ? "Search" : "Search homes"}
      </Text>
    </Pressable>
  );
}

function UpdatesBell() {
  const router = useRouter();
  const { state } = useAuth();
  const unread = useUnreadUpdates();
  const signedIn = state.status === "signed_in";

  return (
    <HeaderCircleButton
      bare
      icon="notifications-outline"
      badge={unread}
      label={!signedIn ? "Sign in to see updates" : unread ? `Updates, ${unread} unread` : "Updates"}
      onPress={() => router.push((signedIn ? "/(app)/notifications" : "/(auth)/sign-in") as never)}
    />
  );
}

/** The tenant's trailing tools: help where a page has a guide, then the bell. */
export function TenantHeaderActions({ helpTopic }: { helpTopic?: "services" | "payments" }) {
  const router = useRouter();

  return (
    <HeaderActions>
      {helpTopic ? (
        <HeaderCircleButton
          bare
          icon="headset-outline"
          label={`Help with ${helpTopic}`}
          onPress={() => router.push({ pathname: "/(app)/help", params: { topic: helpTopic } } as never)}
        />
      ) : null}
      <UpdatesBell />
    </HeaderActions>
  );
}

/** The landlord's trailing tools: the bell, and the create action in white. */
export function ProviderHeaderActions() {
  const router = useRouter();

  return (
    <HeaderActions>
      <UpdatesBell />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add or create"
        onPress={() => router.push("/(app)/provider-actions" as never)}
        hitSlop={5}
        style={({ pressed }) => [styles.create, pressed ? styles.createPressed : null]}
      >
        <Ionicons name="add" size={24} color={shell.chrome} />
      </Pressable>
    </HeaderActions>
  );
}

/**
 * The artisan's trailing tool: the bell, and nothing to create. Their work
 * arrives by invitation, so there is no "add" for them to start.
 */
export function ArtisanHeaderActions() {
  return (
    <HeaderActions>
      <UpdatesBell />
    </HeaderActions>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: AVATAR,
    height: AVATAR,
    marginLeft: space[4],
    borderRadius: AVATAR / 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: alpha(shell.onChrome, 0.9),
    backgroundColor: alpha(theme.color.kola["900"], 0.22),
  },
  avatarPressed: {
    backgroundColor: shell.chromePressed,
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  initials: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "600",
    letterSpacing: 0.3,
    color: shell.onChrome,
  },
  // A darker well than the buttons, like a slot cut into the green.
  pill: {
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingLeft: 5,
    paddingRight: space[4],
    borderRadius: radius.pill,
    backgroundColor: alpha(theme.color.kola["900"], 0.4),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: alpha(shell.onChrome, 0.16),
  },
  pillPressed: {
    backgroundColor: alpha(theme.color.kola["900"], 0.58),
  },
  pillGlyph: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: shell.onChrome,
  },
  pillLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "500",
    color: shell.onChrome,
  },
  create: {
    width: CREATE_DISC,
    height: CREATE_DISC,
    borderRadius: CREATE_DISC / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: shell.onChrome,
  },
  createPressed: {
    backgroundColor: theme.color.field["200"],
  },
});
