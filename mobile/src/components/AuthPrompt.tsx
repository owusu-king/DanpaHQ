import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { IndexGround } from "@/components/account/IndexRows";
import { Type, space } from "@/components/ui";
import { rememberOnboardingIntent } from "@/onboardingIntent";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { theme } from "@/theme";

/** A quiet signed-out state: one lock, a short explanation, and a way in. */
export function AuthPrompt({ title, body, next }: { title: string; body: string; next: string }) {
  const router = useRouter();
  const pageBottom = useSafeBottom(space[10]);

  // Preserve the browsing intent and destination through sign-in.
  const go = () =>
    void rememberOnboardingIntent("find_property").then(() =>
      router.push({ pathname: "/(auth)/sign-in", params: { next, intent: "find_property" } }),
    );

  return (
    <IndexGround>
      <ScrollView contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]}>
        <View style={styles.block}>
          <View style={styles.emblem} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Ionicons name="lock-closed-outline" size={32} color={theme.color.kola["600"]} />
          </View>
          <View style={styles.heading}>
            <Type variant="title2" accessibilityRole="header" style={styles.title}>{title}</Type>
            <Type variant="body" style={styles.body}>{body}</Type>
          </View>
          <Pressable
            onPress={go}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            {...pressableFeedback(theme.color.field["0"])}
            style={({ pressed }) => [styles.act, pressed ? styles.actPressed : null]}
          >
            <Type variant="bodyStrong" style={styles.actText}>Sign in</Type>
          </Pressable>
        </View>
      </ScrollView>
    </IndexGround>
  );
}

const styles = StyleSheet.create({
  page: {
    flexGrow: 1,
    justifyContent: "center",
    paddingTop: space[6],
    paddingHorizontal: space[5],
  },
  block: {
    width: "100%",
    maxWidth: 320,
    alignSelf: "center",
    alignItems: "center",
    gap: space[4],
  },
  emblem: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.color.kola["50"],
    alignItems: "center",
    justifyContent: "center",
  },
  heading: {
    gap: space[2],
    alignItems: "center",
  },
  title: {
    textAlign: "center",
    color: theme.color.ink["900"],
  },
  body: {
    textAlign: "center",
    color: theme.color.ink["500"],
  },
  act: {
    minWidth: 160,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[5],
    borderRadius: 16,
    backgroundColor: theme.color.kola["600"],
    overflow: "hidden",
  },
  actPressed: {
    backgroundColor: theme.color.kola["800"],
  },
  actText: {
    color: theme.color.field["0"],
  },
});
