import { useRouter } from "expo-router";

import { useAuth } from "@/auth";
import { HeaderActions, HeaderCircleButton } from "@/components/nav/HeaderCircleButton";

/** Secondary tools for the tenant's Services and Payments tabs. */
export function UtilityHeaderActions({ topic }: { topic: "services" | "payments" }) {
  const router = useRouter();
  const { state } = useAuth();

  return (
    <HeaderActions>
      <HeaderCircleButton
        compact
        icon="headset-outline"
        label={`Help with ${topic}`}
        onPress={() => router.push({ pathname: "/(app)/help", params: { topic } } as never)}
      />
      <HeaderCircleButton
        compact
        icon="notifications-outline"
        label={state.status === "signed_in" ? "Updates" : "Sign in to see updates"}
        onPress={() => state.status === "signed_in"
          ? router.push("/(app)/notifications" as never)
          : router.push("/(auth)/sign-in" as never)}
      />
    </HeaderActions>
  );
}
