import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Tabs } from "expo-router";

import { useAuth } from "@/auth";
import { ExploreHeaderActions } from "@/components/nav/ExploreHeaderActions";
import { MainTabBar } from "@/components/nav/MainTabBar";
import { TabHeader } from "@/components/nav/TabHeader";
import { UtilityHeaderActions } from "@/components/nav/UtilityHeaderActions";
import { Wordmark } from "@/components/shell/Wordmark";
import { shell } from "@/shell";

export default function RenterTabsLayout() {
  const { state } = useAuth();
  // Signed in, Home is the tenant's dashboard, on the soft green ground. Signed
  // out it is the public browsing page, which stands on ivory like every other tab.
  const home = state.status === "signed_in" ? shell.dashboard : shell.canvas;

  return (
    <Tabs
      tabBar={(props) => <MainTabBar {...props} />}
      screenOptions={{
        // Each tab's name is said by its header, on the green chrome.
        header: (props) => <TabHeader {...props} />,
        sceneStyle: { backgroundColor: shell.canvas },
      }}
    >
      {/* Home names itself with its greeting, so its header carries Rooomly's
          mark instead of a second title. */}
      <Tabs.Screen name="index" options={{ title: "Home", headerTitle: () => <Wordmark />, sceneStyle: { backgroundColor: home }, tabBarLabel: "Home", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "home" : "home-outline"} color={color} size={size} /> }} />
      {/* The header actions live here rather than in the screen: `explore` is a
          re-export of `search`, which is also a pushed route of its own, and a
          header wired inside the component would follow it there. */}
      <Tabs.Screen name="explore" options={{ title: "Explore", tabBarLabel: "Explore", headerRight: () => <ExploreHeaderActions />, tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="globe-model" color={color} size={size} /> }} />
      <Tabs.Screen name="services" options={{ title: "Services", tabBarLabel: "Services", headerRight: () => <UtilityHeaderActions topic="services" />, tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "grid" : "grid-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="payments" options={{ title: "Payments", tabBarLabel: "Payments", headerRight: () => <UtilityHeaderActions topic="payments" />, tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "wallet" : "wallet-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: "More", tabBarLabel: "More", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "list" : "list-outline"} color={color} size={size} /> }} />
    </Tabs>
  );
}
