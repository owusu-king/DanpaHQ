import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/auth";
import { resolveEntryRoute } from "@/navigation";
import { gestureBackEnabled, needsStatusBarBackground, stackAnimation } from "@/platform";
import { theme } from "@/theme";

/**
 * Routes the person to the right place based on whether they are signed in.
 *
 * Deliberately not a splash screen that waits: on a slow connection the token
 * refresh can take seconds, and holding a blank screen makes the app feel
 * broken. The loading state renders the shell immediately and swaps in content.
 */
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

function Gate({ children }: { children: React.ReactNode }) {
  const { state, activeContext } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "loading") return;

    // Read as plain strings. The typed-route generator narrows useSegments()
    // to whatever routes happen to exist, so indexing it directly makes this
    // file stop compiling whenever that generated artifact is missing or stale.
    const routeSegments = segments as readonly string[];
    const group = routeSegments[0] ?? "";
    const screen = routeSegments[1] ?? "";

    const inAuthFlow = group === "(auth)";
    const signedOutScreen = SIGNED_OUT_SCREENS.includes(screen);
    const atRoot = routeSegments.length === 0
      || (routeSegments.length === 1 && routeSegments[0] === "index");
    const inPublicDiscovery = group === "(app)" && (screen === "(tabs)" || screen === "listing");

    if (state.status === "signed_out" && !inPublicDiscovery && (!inAuthFlow || !signedOutScreen)) {
      // Always the journey. Where it *opens* is the journey's own decision:
      // a first launch starts at the beginning, and anybody who has seen it
      // lands on the last page, which is the choice.
      router.replace("/(auth)/welcome");
    } else if (state.status === "signed_in") {
      const destination = resolveEntryRoute(state.me, activeContext);
      // An unfinished registration is the one state that pins someone to a
      // screen. Everything else is a destination they can navigate away from.
      const expectedAuthScreen = destination.endsWith("/register") ? "register" : null;
      if (atRoot) {
        router.replace(destination as never);
      } else if (expectedAuthScreen && (!inAuthFlow || screen !== expectedAuthScreen)) {
        router.replace(destination as never);
      } else if (!expectedAuthScreen && inAuthFlow) {
        router.replace(destination as never);
      }
    }
  }, [activeContext, state, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar
          style="dark"
          backgroundColor={needsStatusBarBackground ? theme.color.field["50"] : undefined}
        />
        <Gate>
          <Stack
            screenOptions={{
              headerShadowVisible: false,
              headerStyle: { backgroundColor: theme.color.field["50"] },
              headerTitleStyle: { fontSize: 18, fontWeight: "600", color: theme.color.ink["900"] },
              headerTintColor: theme.color.kola["600"],
              contentStyle: { backgroundColor: theme.color.field["50"] },
              // Each platform gets its own transition. See src/platform.ts.
              animation: stackAnimation,
              gestureEnabled: gestureBackEnabled,
            }}
          >
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="(app)" options={{ headerShown: false }} />
          </Stack>
        </Gate>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
