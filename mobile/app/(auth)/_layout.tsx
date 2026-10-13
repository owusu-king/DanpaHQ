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
      <Stack.Screen name="start" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="phone" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
      {/* The code screen carries its own way back and its own step marks, and a
          navigator header over the dawn would be a second, flatter one. */}
      <Stack.Screen name="code" options={{ headerShown: false }} />
      <Stack.Screen name="role" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      {/* Arrived at by the gate the moment an account exists. There is nothing
          behind it to go back to: the steps before it are finished. */}
      <Stack.Screen name="welcome" options={{ headerShown: false, gestureEnabled: false, animation: "fade" }} />
    </Stack>
  );
}
