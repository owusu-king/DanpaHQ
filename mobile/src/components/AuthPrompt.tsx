import { useRouter } from "expo-router";
import { View } from "react-native";

import { Button, Notice, Type, space } from "@/components/ui";
import { rememberOnboardingIntent } from "@/onboardingIntent";

export function AuthPrompt({ title, body, next }: { title: string; body: string; next: string }) {
  const router = useRouter();
  return (
    <View style={{ flex: 1, justifyContent: "center", padding: space[5], gap: space[4] }}>
      <Type variant="display2">{title}</Type>
      <Notice tone="info" title="Continue with phone" body={body} />
      <Button
        label="Sign In"
        onPress={() => void rememberOnboardingIntent("find_property").then(() => router.push({
          pathname: "/(auth)/sign-in",
          params: { next, intent: "find_property" },
        }))}
      />
    </View>
  );
}
