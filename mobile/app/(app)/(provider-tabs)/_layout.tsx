import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { useWindowDimensions } from "react-native";

import { MainTabBar } from "@/components/nav/MainTabBar";
import { TabHeader } from "@/components/nav/TabHeader";
import { ProviderHeaderActions } from "@/components/nav/TabHeaderControls";
import { PortfolioHeaderButton } from "@/components/portfolio/PortfolioSwitcher";
import { shell } from "@/shell";

export default function ProviderTabsLayout() {
  const { width } = useWindowDimensions();
  const compact = width <= 390;

  return (
    <Tabs
      tabBar={(props) => <MainTabBar {...props} />}
      screenOptions={{
        header: (props) => <TabHeader {...props} />,
        sceneStyle: { backgroundColor: shell.canvas },
        headerLeft: () => <PortfolioHeaderButton compact={compact} />,
        headerRight: () => <ProviderHeaderActions />,
      }}
    >
      {/* Every tab shares one tool row: the Portfolio, the bell and the create
          action. The tab bar names the page, so the header does not. */}
      <Tabs.Screen name="index" options={{ title: "Home", headerShadowVisible: false, sceneStyle: { backgroundColor: shell.dashboard }, tabBarLabel: "Home", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "home" : "home-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="properties" options={{ title: "Properties", tabBarLabel: "Properties", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "business" : "business-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="tenants" options={{ title: "Tenants", tabBarLabel: "Tenants", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "people" : "people-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="payments" options={{ title: "Payments", tabBarLabel: "Payments", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "wallet" : "wallet-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="more" options={{ title: "Menu", tabBarLabel: "Menu", headerShown: false, tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "list" : "list-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="add" options={{ href: null }} />
    </Tabs>
  );
}
