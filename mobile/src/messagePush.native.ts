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

async function iosMessaging() {
  const sdk = await import("@react-native-firebase/messaging");
  return { sdk, messaging: sdk.getMessaging() };
}

export async function registerMessagePush(
  requestPermission = false,
  userId?: string,
  signal?: AbortSignal,
  refreshedToken?: string,
): Promise<boolean> {
  const sdk = await notifications();
  if (!sdk || signal?.aborted) return false;
  const preferences = await getNotificationPreferences();
  if (!preferences.push_enabled) return false;
  const firebase = Platform.OS === "ios" ? await iosMessaging() : null;
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
    await apiFetch("/me/push-token/", { method: "DELETE", body: { recipient_id: userId }, signal });
    return false;
  }
  let token = refreshedToken;
  if (!token) {
    const nativeToken = await sdk.getDevicePushTokenAsync();
    token = nativeToken.data;
    if (firebase) {
      await firebase.sdk.setAPNSToken(firebase.messaging, nativeToken.data);
      token = await firebase.sdk.getToken(firebase.messaging);
    }
  }
  if (signal?.aborted) return false;
  await apiFetch("/me/push-token/", {
    method: "PUT", body: { token: `fcm:${token}`, recipient_id: userId }, signal,
  });
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
    const controller = new AbortController();
    let registration: Promise<boolean> | undefined;
    let refreshPending = false;
    let pendingToken: string | undefined;
    const subscriptions: { remove(): void }[] = [];
    const register = (ask: boolean, refreshedToken?: string) => {
      if (controller.signal.aborted) return;
      if (registration) {
        refreshPending = true;
        pendingToken = refreshedToken ?? pendingToken;
        return;
      }
      registration = registerMessagePush(ask, userId, controller.signal, refreshedToken);
      void registration.catch(() => {
        if (controller.signal.aborted) return;
        console.warn("Message push registration unavailable; Updates is still available.");
      }).finally(() => {
        registration = undefined;
        if (refreshPending) {
          const token = pendingToken;
          refreshPending = false;
          pendingToken = undefined;
          register(false, token);
        }
      });
    };
    void notifications().then((sdk) => {
      if (!sdk || controller.signal.aborted) return;
      sdk.setNotificationHandler({
        handleNotification: async (notification) => {
          const mine = notification.request.content.data?.recipient_id === currentUser.current;
          return { shouldShowBanner: mine, shouldShowList: mine, shouldPlaySound: mine, shouldSetBadge: false };
        },
      });
      const open = (response: import("expo-notifications").NotificationResponse | null) => {
        if (!response || controller.signal.aborted) return;
        const { identifier, content } = response.notification.request;
        if (handled.current === identifier) return;
        handled.current = identifier;
        void sdk.clearLastNotificationResponseAsync().catch(() => undefined);
        const data = content.data ?? {};
        if (response.actionIdentifier !== sdk.DEFAULT_ACTION_IDENTIFIER
          || data.recipient_id !== currentUser.current
          || data.target_type !== "sale_enquiry"
          || typeof data.target_id !== "string"
          || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data.target_id)) return;
        // The conversation endpoint independently checks membership.
        router.push({ pathname: "/(app)/enquiry/[id]", params: { id: data.target_id } });
      };
      subscriptions.push(sdk.addNotificationResponseReceivedListener(open));
      if (Platform.OS === "android") {
        // Reading the native token from this listener would emit another token event.
        subscriptions.push(sdk.addPushTokenListener(({ data }) => register(false, data)));
      } else {
        void iosMessaging().then(({ sdk: firebase, messaging }) => {
          if (!controller.signal.aborted) {
            subscriptions.push({
              remove: firebase.onTokenRefresh(messaging, (token) => register(false, token)),
            });
          }
        }).catch(() => undefined);
      }
      void sdk.getLastNotificationResponseAsync().then(open).catch(() => undefined);
      register(true);
    }).catch(() => {
      console.warn("Message push requires a rebuilt native app; Updates is still available.");
    });
    subscriptions.push(AppState.addEventListener("change", (next) => {
      if (next === "active") register(false);
    }));
    return () => {
      controller.abort();
      currentUser.current = null;
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [userId, router]);
  return null;
}
