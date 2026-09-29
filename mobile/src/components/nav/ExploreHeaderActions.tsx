import { useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { useAuth } from "@/auth";
import { HeaderActions, HeaderCircleButton } from "@/components/nav/HeaderCircleButton";
import { resolvePhotoUrl } from "@/photo";

/**
 * Saved and Profile, reachable from the top of Explore.
 *
 * Scoped to the Explore *tab* rather than to the screen behind it. That screen
 * is `search.tsx`, which is also registered as a pushed `/search` route — one
 * component, two places — and a header wired inside it would have appeared on
 * both, giving the pushed route a second way to reach tabs it has no tab bar
 * for.
 *
 * Saved is a pushed screen of its own (2026-09-15) rather than a hidden tab, so
 * it carries a back arrow and no tab bar, beside Verification and Security. More
 * → "Saved places" pushes this exact href too: one transition, one behaviour.
 */
export function ExploreHeaderActions() {
  const router = useRouter();
  const { state } = useAuth();
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const avatarEndpoint =
    state.status === "signed_in" ? (state.me.profile?.avatar_url ?? null) : null;

  useEffect(() => {
    let live = true;
    setPhotoUri(null);
    if (!avatarEndpoint) return;
    // Guarded: the photo may change before this resolves, and writing a stale
    // URL would flash the previous picture. `resolvePhotoUrl` caches, so this
    // costs one request per session rather than one per screen.
    void resolvePhotoUrl(avatarEndpoint).then((url) => {
      if (live) setPhotoUri(url);
    });
    return () => {
      live = false;
    };
  }, [avatarEndpoint]);

  return (
    <HeaderActions>
      <HeaderCircleButton
        icon="bookmark-outline"
        label="Saved"
        compact
        onPress={() => router.push("/(app)/saved" as never)}
      />
      <HeaderCircleButton
        icon="person-outline"
        label="Your profile"
        imageUri={photoUri}
        compact
        onPress={() => router.push("/(app)/(tabs)/profile" as never)}
      />
    </HeaderActions>
  );
}
