import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs, useRouter } from "expo-router";
import { Pressable, useWindowDimensions } from "react-native";

import { MainTabBar } from "@/components/nav/MainTabBar";
import { PortfolioHeaderButton } from "@/components/portfolio/PortfolioSwitcher";
import { theme } from "@/theme";

export default function ProviderTabsLayout() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compact = width <= 390;
  return (
    <Tabs
      tabBar={(props) => <MainTabBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: theme.color.field["50"] },
        headerShadowVisible: false,
        headerTitleStyle: { fontSize: compact ? 16 : 18, fontWeight: "600" },
        headerLeft: () => <PortfolioHeaderButton compact={compact} />,
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add or create"
            onPress={() => router.push("/(app)/provider-actions" as never)}
            hitSlop={compact ? 4 : 1}
            style={{
              width: compact ? 38 : 42,
              height: compact ? 38 : 42,
              borderRadius: compact ? 19 : 21,
              marginRight: compact ? 12 : 16,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.color.kola["600"],
            }}
          >
            <Ionicons name="add" size={compact ? 24 : 28} color={theme.color.field["0"]} />
          </Pressable>
        ),
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarLabel: "Home", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "home" : "home-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="properties" options={{ title: "Properties", tabBarLabel: "Properties", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "business" : "business-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="tenants" options={{ title: "Tenants", tabBarLabel: "Tenants", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "people" : "people-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="payments" options={{ title: "Payments", tabBarLabel: "Payments", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "wallet" : "wallet-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarLabel: "More", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "ellipsis-horizontal-circle" : "ellipsis-horizontal-circle-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="add" options={{ href: null }} />
    </Tabs>
  );
}
