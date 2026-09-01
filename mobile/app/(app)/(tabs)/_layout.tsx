import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";

import { ExploreHeaderActions } from "@/components/nav/ExploreHeaderActions";
import { MainTabBar } from "@/components/nav/MainTabBar";
import { theme } from "@/theme";

export default function RenterTabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <MainTabBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: theme.color.field["50"] },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarLabel: "Home", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "home" : "home-outline"} color={color} size={size} /> }} />
      {/* The header actions live here rather than in the screen: `explore` is a
          re-export of `search`, which is also a pushed route of its own, and a
          header wired inside the component would follow it there. */}
      <Tabs.Screen name="explore" options={{ title: "Explore", tabBarLabel: "Explore", headerRight: () => <ExploreHeaderActions />, tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "compass" : "compass-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="services" options={{ title: "Services", tabBarLabel: "Services", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "grid" : "grid-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="payments" options={{ title: "Payments", tabBarLabel: "Payments", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "wallet" : "wallet-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarLabel: "More", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "ellipsis-horizontal-circle" : "ellipsis-horizontal-circle-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="saved" options={{ href: null }} />
    </Tabs>
  );
}
