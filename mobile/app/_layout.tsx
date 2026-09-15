import { ThemeProvider } from "@react-navigation/native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/auth";
import { LaunchCurtain } from "@/components/shell/LaunchScreen";
import { TypographyScaleProvider } from "@/components/ui";
import { resolveEntryRoute } from "@/navigation";
import { gestureBackEnabled, stackAnimation } from "@/platform";
import { navigationTheme, shell } from "@/shell";

/**
 * Screens a signed-out person is allowed to be on.
 *
 * Anything not listed here is bounced to welcome, which is correct for the app
 * shell and catastrophic if the list falls behind the routes: a missing entry
 * does not fail loudly, it silently throws the person back to welcome the
 * instant they tap through. That is exactly what happened when sign-in,
 * register and forgot-password were added without touching this line.
 *
 * `register` is here because a person mid-registration is signed in only in the
 * narrow sense that a proved number issued them a session; if that session is
 * lost they must still be able to reach the screen again.
 */
const SIGNED_OUT_SCREENS = [
  "welcome",
  "sign-in",
  "phone",
  "code",
  "register",
  "forgot-password",
];

/**
 * Tabs both workspaces have, which therefore share an address.
 *
 * A folder in parentheses adds nothing to the URL, so `(tabs)/payments` and
 * `(provider-tabs)/payments` are both `/payments`, and a refresh there opens
 * whichever group sorts first — the provider's. `/` is the other shared address,
 * and it resolves to `app/index.tsx`, which is always replaced.
 */
const SHARED_TABS = ["payments"];

type Session = ReturnType<typeof useAuth>["state"];

/**
 * Where this person has to be instead of here, or `null` when here is right.
 *
 * Pure, and asked while rendering. The gate used to answer it in an effect,
 * after the screen at the address had already drawn without a session — the
 * signed-out version of whatever was there, which for a tenant's Home was the
 * browsing page — and only then moved. Asked during render, the frame that would
 * have shown the wrong screen already knows it is the wrong one, and the launch
 * curtain stays in front of it.
 */
function entryRedirect(
  session: Exclude<Session, { status: "loading" }>,
  activeContext: string | null,
  segments: readonly string[],
): string | null {
  const group = segments[0] ?? "";
  const screen = segments[1] ?? "";
  const tab = segments[2] ?? "";

  const inAuthFlow = group === "(auth)";
  const signedOutScreen = SIGNED_OUT_SCREENS.includes(screen);
  const atRoot = segments.length === 0
    || (segments.length === 1 && segments[0] === "index");
  const inPublicDiscovery = group === "(app)" && (screen === "(tabs)" || screen === "listing");
  const inProviderTabs = group === "(app)" && screen === "(provider-tabs)";
  // The renter's tab at the same address, for an address both workspaces answer.
  const renterTwin = inProviderTabs && SHARED_TABS.includes(tab) ? `/(app)/(tabs)/${tab}` : null;

  if (session.status === "signed_out") {
    if (inPublicDiscovery || (inAuthFlow && signedOutScreen)) return null;
    // Always the journey. Where it *opens* is the journey's own decision:
    // a first launch starts at the beginning, and anybody who has seen it
    // lands on the last page, which is the choice.
    return renterTwin ?? "/(auth)/welcome";
  }

  const destination = resolveEntryRoute(session.me, activeContext);
  // An unfinished registration is the one state that pins someone to a
  // screen. Everything else is a destination they can navigate away from.
  const expectedAuthScreen = destination.endsWith("/register") ? "register" : null;
  if (atRoot) return destination;
  if (expectedAuthScreen) return inAuthFlow && screen === expectedAuthScreen ? null : destination;
  if (inAuthFlow) return destination;

  // The provider tabs are the provider workspace. Somebody who is not in it — a
  // tenant, or a provider who switched to renting — never sees them, however the
  // address was reached. The backend's own destination is trusted when it is the
  // provider tabs themselves, so the two can never bounce somebody between them.
  const capabilities = session.me.capabilities;
  const mayOperate = capabilities.provider.workspace_access && capabilities.active_workspace === "provider";
  if (inProviderTabs && !mayOperate && !destination.startsWith("/(app)/(provider-tabs)")) {
    return renterTwin ?? destination;
  }
  return null;
}

/**
 * The navigator, the gate in front of it, and the ground under both.
 *
 * Until the session is known and the route is the one it calls for, the launch
 * curtain covers everything: the name, not a blank screen, so a slow token
 * refresh reads as the app opening rather than as the app being broken — and not
 * a guess, which is what a refresh used to show. Behind the curtain the
 * navigator is mounted as normal, so a redirect has somewhere to go, but it is
 * hidden from screen readers and its redirects do not animate: the curtain lifting
 * is the transition.
 */
function Shell() {
  const { state, activeContext } = useAuth();
  // Read as plain strings. The typed-route generator narrows useSegments()
  // to whatever routes happen to exist, so indexing it directly makes this
  // file stop compiling whenever that generated artifact is missing or stale.
  const segments = useSegments() as readonly string[];
  const router = useRouter();

  const redirect = state.status === "loading" ? null : entryRedirect(state, activeContext, segments);
  const settled = state.status !== "loading" && redirect === null;

  useEffect(() => {
    if (redirect) router.replace(redirect as never);
  }, [redirect, router, segments]);

  // Edge to edge, the chrome paints the strip behind the status bar: the launch
  // curtain, and every header in the app. Only the sign-in journey stands on
  // ivory, so only there do the status bar's glyphs turn dark.
  const statusBar = !settled || segments[0] !== "(auth)" ? "light" : "dark";

  return (
    <View style={{ flex: 1, backgroundColor: shell.canvas }}>
      <StatusBar style={statusBar} />
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={!settled}
        importantForAccessibility={settled ? "auto" : "no-hide-descendants"}
      >
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: shell.canvas },
            // Each platform gets its own transition. See src/platform.ts.
            animation: settled ? stackAnimation : "none",
            gestureEnabled: gestureBackEnabled,
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
      </View>
      <LaunchCurtain settled={settled} />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ThemeProvider value={navigationTheme}>
        <TypographyScaleProvider>
          <AuthProvider>
            <Shell />
          </AuthProvider>
        </TypographyScaleProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
