/** Native credential acquisition is lazy so Expo Go can still use phone auth. */
import Constants from "expo-constants";
import { Platform } from "react-native";

type GoogleConfiguration = { webClientId?: string; iosClientId?: string };
const configuration = () => (Constants.expoConfig?.extra?.googleSignIn ?? {}) as GoogleConfiguration;

export function googleUnavailableReason(): string | null {
  if (Constants.executionEnvironment === "storeClient") return "Use the installed app for Google sign-in, or continue with your phone.";
  if (Platform.OS !== "android" && Platform.OS !== "ios") return "Continue with your phone on this device.";
  const config = configuration();
  if (!config.webClientId || (Platform.OS === "ios" && !config.iosClientId)) {
    return "Google sign-in is not configured in this build. Continue with your phone.";
  }
  return null;
}

let configured = false;
let pending = false;

export async function getGoogleCredential(): Promise<string | null> {
  const unavailable = googleUnavailableReason();
  if (unavailable) throw new Error(unavailable);
  if (pending) return null;
  pending = true;
  try {
    // Importing a native Nitro module at startup would crash Expo Go.
    const { GoogleOneTapSignIn } = await import("react-native-nitro-google-signin");
    if (!configured) {
      const { webClientId, iosClientId } = configuration();
      GoogleOneTapSignIn.configure({ webClientId: webClientId!, ...(iosClientId ? { iosClientId } : {}) });
      configured = true;
    }
    await GoogleOneTapSignIn.checkPlayServices();
    // An explicit action always presents the account chooser, including after logout.
    const response = await GoogleOneTapSignIn.presentExplicitSignIn();
    if (response.type === "cancelled") return null;
    if (response.type !== "success" || !response.data?.idToken) {
      throw new Error("Google could not complete sign-in. Try another account or use your phone.");
    }
    return response.data.idToken;
  } catch (cause) {
    const code = (cause as { code?: string })?.code;
    if (code === "SIGN_IN_CANCELLED" || code === "12501") return null;
    if (code === "PLAY_SERVICES_NOT_AVAILABLE") throw new Error("Update Google Play services, then try again. You can also sign in with your phone.");
    if (code === "DEVELOPER_ERROR" || code === "10") throw new Error("Google sign-in is not configured for this app build. Continue with your phone.");
    throw new Error("Google sign-in is unavailable. Try again or continue with your phone.");
  } finally {
    pending = false;
  }
}

export async function clearGoogleIdentity(): Promise<void> {
  if (!configured) return;
  const { GoogleOneTapSignIn } = await import("react-native-nitro-google-signin");
  await GoogleOneTapSignIn.signOut();
}
