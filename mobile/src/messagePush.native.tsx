import Constants, { ExecutionEnvironment } from "expo-constants";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

import { apiFetch } from "@/api";
import { getNotificationPreferences } from "@/notifications";

// Load lazily so Expo Go and older native binaries can still open the inbox.
async function notifications() {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;
  if (!(await import("expo-device")).isDevice) return null;
  return import("expo-notifications");
}

export async function registerMessagePush(requestPermission = false): Promise<boolean> {
  const sdk = await notifications();
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!sdk || !projectId) return false;
  const preferences = await getNotificationPreferences();
  if (!preferences.push_enabled) return false;
  if (Platform.OS === "android") {
    // Android requires a channel before the permission/token request.
    await sdk.setNotificationChannelAsync("messages", {
      name: "Messages", importance: sdk.AndroidImportance.HIGH, sound: "default",
      lockscreenVisibility: sdk.AndroidNotificationVisibility.PRIVATE,
    });
  }
  let permission = await sdk.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain && requestPermission) {
    permission = await sdk.requestPermissionsAsync();
  }
  if (!permission.granted) {
    await apiFetch("/me/push-token/", { method: "DELETE" });
    return false;
  }
  const token = (await sdk.getExpoPushTokenAsync({ projectId })).data;
  await apiFetch("/me/push-token/", { method: "PUT", body: { token } });
  return true;
}

/** Wait for authentication and the app navigator before handling a cold-start tap. */
export function MessagePush({ userId }: { userId: string | null }) {
  const router = useRouter();
  const currentUser = useRef(userId);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    currentUser.current = userId;
    if (!userId) return;
    let cancelled = false;
    const subscriptions: { remove(): void }[] = [];
    const register = (ask: boolean) => {
      if (!cancelled) void registerMessagePush(ask).catch(() => {
        console.warn("Message push registration unavailable; Updates is still available.");
      });
    };
    void notifications().then((sdk) => {
      if (!sdk || cancelled) return;
      sdk.setNotificationHandler({
        handleNotification: async (notification) => {
          const mine = notification.request.content.data?.recipient_id === currentUser.current;
          return { shouldShowBanner: mine, shouldShowList: mine, shouldPlaySound: mine, shouldSetBadge: false };
        },
      });
      const open = (response: import("expo-notifications").NotificationResponse | null) => {
        if (!response || cancelled) return;
        const { identifier, content } = response.notification.request;
        if (handled.current === identifier) return;
        handled.current = identifier;
        void sdk.clearLastNotificationResponseAsync();
        const data = content.data ?? {};
        if (response.actionIdentifier !== sdk.DEFAULT_ACTION_IDENTIFIER
          || data.recipient_id !== currentUser.current
          || data.target_type !== "sale_enquiry"
          || typeof data.target_id !== "string"
          || !/^[0-9a-f-]{36}$/i.test(data.target_id)) return;
        // The conversation endpoint independently checks membership.
        router.push({ pathname: "/(app)/enquiry/[id]", params: { id: data.target_id } });
      };
      subscriptions.push(sdk.addNotificationResponseReceivedListener(open));
      subscriptions.push(sdk.addPushTokenListener(() => register(false)));
      void sdk.getLastNotificationResponseAsync().then(open).catch(() => undefined);
      register(true);
    }).catch(() => {
      console.warn("Message push requires a rebuilt native app; Updates is still available.");
    });
    subscriptions.push(AppState.addEventListener("change", (next) => {
      if (next === "active") register(false);
    }));
    return () => {
      cancelled = true;
      currentUser.current = null;
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [userId, router]);
  return null;
}
