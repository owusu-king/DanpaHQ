import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Tabs } from "expo-router";

import { MainTabBar } from "@/components/nav/MainTabBar";
import { TabHeader } from "@/components/nav/TabHeader";
import { HeaderSearchPill, TenantHeaderActions, TenantProfileButton } from "@/components/nav/TabHeaderControls";
import { shell } from "@/shell";

export default function RenterTabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <MainTabBar {...props} />}
      screenOptions={{
        // Every tab shares one tool row on the green chrome: you, search and the
        // bell. The tab bar names the page, so the header does not.
        header: (props) => <TabHeader {...props} />,
        headerLeft: () => <TenantProfileButton />,
        headerTitle: () => <HeaderSearchPill />,
        headerRight: () => <TenantHeaderActions />,
        sceneStyle: { backgroundColor: shell.canvas },
      }}
    >
      {/* Home stands on the dashboard ground
          whether or not anybody is signed in — the signed-out page stopped
          being a wall of listings, so there is nothing left that the ground
          would have made read as a dashboard. */}
      <Tabs.Screen name="index" options={{ title: "Home", headerShadowVisible: false, sceneStyle: { backgroundColor: shell.dashboard }, tabBarLabel: "Home", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "home" : "home-outline"} color={color} size={size} /> }} />
      {/* Explore draws its own top: the hero carries the title, Saved and
          profile, Rent or Buy, the search and the filters as one green piece
          (owner, 2026-09-29). It adds the actions only inside the tabs, so the
          pushed `/search` route, which shares the component, does not grow them. */}
      <Tabs.Screen name="explore" options={{ title: "Explore", tabBarLabel: "Explore", headerShown: false, tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="globe-model" color={color} size={size} /> }} />
      <Tabs.Screen name="services" options={{ title: "Services", tabBarLabel: "Services", headerRight: () => <TenantHeaderActions helpTopic="services" />, tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "grid" : "grid-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="payments" options={{ title: "Payments", tabBarLabel: "Payments", headerRight: () => <TenantHeaderActions helpTopic="payments" />, tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "wallet" : "wallet-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Menu", tabBarLabel: "Menu", headerShown: false, tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "list" : "list-outline"} color={color} size={size} /> }} />
    </Tabs>
  );
}
