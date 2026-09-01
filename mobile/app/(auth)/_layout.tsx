import { Stack } from "expo-router";

import { gestureBackEnabled, stackAnimation } from "@/platform";
import { theme } from "@/theme";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.color.field["50"] },
        headerTitle: "",
        headerBackTitle: "Back",
        headerTintColor: theme.color.ink["900"],
        contentStyle: { backgroundColor: theme.color.field["50"] },
        animation: stackAnimation,
        gestureEnabled: gestureBackEnabled,
      }}
    >
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="phone" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
      <Stack.Screen name="code" />
      <Stack.Screen name="role" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
    </Stack>
  );
}
