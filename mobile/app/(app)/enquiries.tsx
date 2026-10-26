import Ionicons from "@expo/vector-icons/Ionicons";
import { useIsFocused, useRouter, type Href } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/auth";
import { AskDanpaSurface } from "@/components/AskDanpa";
import { space } from "@/components/ui";
import { resolveEntryRoute } from "@/navigation";
import { safeHeaderTop, useSafeBottom } from "@/platform";
import { theme } from "@/theme";

export default function DanpaIntelScreen() {
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { state, activeContext } = useAuth();
  const bottom = useSafeBottom(space[8]);
  const close = () => {
    if (router.canGoBack()) { router.back(); return; }
    const home = state.status === "signed_in" ? resolveEntryRoute(state.me, activeContext) : "/(app)/(tabs)";
    router.replace(home as Href);
  };
  return <SafeAreaView edges={["left", "right"]} style={{ flex: 1, paddingTop: safeHeaderTop(insets.top), backgroundColor: theme.color.field["50"] }}>
    {focused ? <StatusBar style="dark" /> : null}
    <View style={{ alignItems: "flex-end", paddingHorizontal: space[4] }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close Danpa Intel" onPress={close}
        style={({ pressed }) => ({ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
        <Ionicons name="close" size={24} color={theme.color.kola["800"]} />
      </Pressable>
    </View>
    <ScrollView contentContainerStyle={{ paddingHorizontal: space[5], paddingBottom: bottom }}>
      <AskDanpaSurface onSupport={() => router.push("/(app)/support-tickets")} />
    </ScrollView>
  </SafeAreaView>;
}
