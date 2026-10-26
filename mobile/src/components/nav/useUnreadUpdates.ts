import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { useAuth } from "@/auth";
import { listNotifications } from "@/notifications";

/**
 * How many updates are unread, for the bell in a tab's header.
 *
 * Read again each time the tab comes into focus, so coming back from Updates
 * (which marks them read) clears the badge. A failed read shows no badge rather
 * than a stale one. Signed out, there is nothing to count.
 */
export function useUnreadUpdates(): number {
  const { state } = useAuth();
  const signedIn = state.status === "signed_in";
  const [unread, setUnread] = useState(0);

  useFocusEffect(useCallback(() => {
    let live = true;
    if (!signedIn) {
      setUnread(0);
      return;
    }
    void listNotifications(true)
      .then((page) => { if (live) setUnread(page.unread_count); })
      .catch(() => { if (live) setUnread(0); });
    return () => {
      live = false;
    };
  }, [signedIn]));

  return unread;
}
