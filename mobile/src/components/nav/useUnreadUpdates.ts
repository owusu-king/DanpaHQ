import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { useAuth } from "@/auth";
import { getUnreadNotificationCount } from "@/notifications";

/**
 * How many updates are unread, for the bell in a tab's header.
 *
 * Read again each time the tab comes into focus, so coming back from Updates
 * (which marks them read) clears the badge. A failed read shows no badge rather
 * than a stale one. Signed out, there is nothing to count.
 */
export function useUnreadUpdates(): number {
  const { state } = useAuth();
  const userId = state.status === "signed_in" ? state.me.id : null;
  const [badge, setBadge] = useState<{ userId: string; count: number } | null>(null);

  useFocusEffect(useCallback(() => {
    let live = true;
    if (!userId) {
      setBadge(null);
      return;
    }
    void getUnreadNotificationCount()
      .then((count) => { if (live) setBadge({ userId, count }); })
      .catch(() => { if (live) setBadge(null); });
    return () => {
      live = false;
    };
  }, [userId]));

  return badge?.userId === userId ? badge.count : 0;
}
