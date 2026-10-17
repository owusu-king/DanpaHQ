import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useWindowDimensions } from "react-native";

import { MainTabBar } from "@/components/nav/MainTabBar";
import { nativeTabHaptics } from "@/components/nav/NativeTabFrame";
import { TabHeader } from "@/components/nav/TabHeader";
import { ProviderHeaderActions } from "@/components/nav/TabHeaderControls";
import { PortfolioHeaderButton } from "@/components/portfolio/PortfolioSwitcher";
import { isIOS } from "@/platform";
import { shell } from "@/shell";
import { theme } from "@/theme";

export default function ProviderTabsLayout() {
  return isIOS ? <ProviderNativeTabs /> : <ProviderJsTabs />;
}

/**
 * iOS: Apple's own tab bar, as the renter has it (owner, 2026-10-15). Each
 * route frames its page in `ProviderTabFrame`, which draws the Portfolio, the
 * bell and the create action, since the native bar draws no header.
 *
 * `add` stays in the navigator and off the bar. A native tab that is hidden
 * cannot be the focused one, and nothing navigates there today; anything that
 * starts to should push `/provider` instead.
 */
function ProviderNativeTabs() {
  return (
    <NativeTabs tintColor={theme.color.kola["600"]} screenListeners={nativeTabHaptics}>
      <NativeTabs.Trigger name="index" disableAutomaticContentInsets contentStyle={{ backgroundColor: shell.dashboard }}>
        <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="properties" disableAutomaticContentInsets contentStyle={{ backgroundColor: shell.canvas }}>
        <NativeTabs.Trigger.Icon sf={{ default: "building.2", selected: "building.2.fill" }} />
        <NativeTabs.Trigger.Label>Properties</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tenants" disableAutomaticContentInsets contentStyle={{ backgroundColor: shell.canvas }}>
        <NativeTabs.Trigger.Icon sf={{ default: "person.2", selected: "person.2.fill" }} />
        <NativeTabs.Trigger.Label>Tenants</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="payments" disableAutomaticContentInsets contentStyle={{ backgroundColor: shell.canvas }}>
        <NativeTabs.Trigger.Icon sf={{ default: "wallet.bifold", selected: "wallet.bifold.fill" }} />
        <NativeTabs.Trigger.Label>Payments</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more" disableAutomaticContentInsets contentStyle={{ backgroundColor: shell.canvas }}>
        <NativeTabs.Trigger.Icon sf="list.bullet" />
        <NativeTabs.Trigger.Label>Menu</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="add" hidden />
    </NativeTabs>
  );
}

/** Android: the JS tabs and their shelf, unchanged. */
function ProviderJsTabs() {
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
