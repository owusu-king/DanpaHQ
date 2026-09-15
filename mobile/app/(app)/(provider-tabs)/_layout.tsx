import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs, useRouter } from "expo-router";
import { Pressable, useWindowDimensions } from "react-native";

import { MainTabBar } from "@/components/nav/MainTabBar";
import { TabHeader } from "@/components/nav/TabHeader";
import { PortfolioHeaderButton } from "@/components/portfolio/PortfolioSwitcher";
import { Wordmark } from "@/components/shell/Wordmark";
import { space } from "@/components/ui";
import { isAndroid } from "@/platform";
import { shell } from "@/shell";
import { theme } from "@/theme";

/** The create action's disc: 40pt drawn, the 48pt floor reached with slop. */
const ADD_DISC = 40;

export default function ProviderTabsLayout() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compact = width <= 390;

  return (
    <Tabs
      tabBar={(props) => <MainTabBar {...props} />}
      screenOptions={{
        header: (props) => <TabHeader {...props} />,
        sceneStyle: { backgroundColor: shell.canvas },
        headerLeft: () => <PortfolioHeaderButton compact={compact} />,
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add or create"
            onPress={() => router.push("/(app)/provider-actions" as never)}
            hitSlop={space[1]}
            android_ripple={
              isAndroid
                ? { color: theme.color.field["300"], radius: ADD_DISC / 2, borderless: true }
                : undefined
            }
            style={({ pressed }) => ({
              width: ADD_DISC,
              height: ADD_DISC,
              borderRadius: ADD_DISC / 2,
              marginRight: compact ? space[3] : space[4],
              alignItems: "center",
              justifyContent: "center",
              // The create action is the primary action: a solid white disc on
              // the green, with its glyph in the chrome's kola.
              backgroundColor: pressed && !isAndroid ? theme.color.field["200"] : shell.onChrome,
            })}
          >
            <Ionicons name="add" size={24} color={shell.chrome} />
          </Pressable>
        ),
      }}
    >
      {/* The Portfolio's Home names itself with its greeting; its header keeps
          the switcher and the create action around Rooomly's mark. */}
      <Tabs.Screen name="index" options={{ title: "Home", headerTitle: () => <Wordmark />, sceneStyle: { backgroundColor: shell.dashboard }, tabBarLabel: "Home", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "home" : "home-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="properties" options={{ title: "Properties", tabBarLabel: "Properties", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "business" : "business-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="tenants" options={{ title: "Tenants", tabBarLabel: "Tenants", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "people" : "people-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="payments" options={{ title: "Payments", tabBarLabel: "Payments", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "wallet" : "wallet-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarLabel: "More", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "ellipsis-horizontal-circle" : "ellipsis-horizontal-circle-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="add" options={{ href: null }} />
    </Tabs>
  );
}
