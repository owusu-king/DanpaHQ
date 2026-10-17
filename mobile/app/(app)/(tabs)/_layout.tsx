import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";

import { MainTabBar } from "@/components/nav/MainTabBar";
import { nativeTabHaptics } from "@/components/nav/NativeTabFrame";
import { TabHeader } from "@/components/nav/TabHeader";
import { HeaderSearchPill, TenantHeaderActions, TenantProfileButton } from "@/components/nav/TabHeaderControls";
import { isIOS } from "@/platform";
import { shell } from "@/shell";
import { theme } from "@/theme";

export default function RenterTabsLayout() {
  return isIOS ? <RenterNativeTabs /> : <RenterJsTabs />;
}

/**
 * iOS: Apple's own tab bar (owner, 2026-10-15) — the real Liquid Glass, its
 * morphing selection, lens and haptics, as WhatsApp and the rest of the phone
 * have it. The icons are SF Symbols, outline at rest and filled when chosen,
 * in Danpa HQ's green.
 *
 * The native bar draws no header, so each tab route wraps its page in
 * `RenterTabFrame`, which draws the same tool row the JS tabs do. Automatic
 * scroll insets are off: every page already keeps clear of the bar through
 * `useSafeBottom`, whose inset inside a native tab includes the bar, and the
 * two together would leave the gap twice.
 */
function RenterNativeTabs() {
  return (
    <NativeTabs tintColor={theme.color.kola["600"]} screenListeners={nativeTabHaptics}>
      <NativeTabs.Trigger name="index" disableAutomaticContentInsets contentStyle={{ backgroundColor: shell.dashboard }}>
        <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="explore" disableAutomaticContentInsets contentStyle={{ backgroundColor: shell.canvas }}>
        <NativeTabs.Trigger.Icon sf={{ default: "globe.europe.africa", selected: "globe.europe.africa.fill" }} />
        <NativeTabs.Trigger.Label>Explore</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="services" disableAutomaticContentInsets contentStyle={{ backgroundColor: shell.canvas }}>
        <NativeTabs.Trigger.Icon sf={{ default: "square.grid.2x2", selected: "square.grid.2x2.fill" }} />
        <NativeTabs.Trigger.Label>Services</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="payments" disableAutomaticContentInsets contentStyle={{ backgroundColor: shell.canvas }}>
        <NativeTabs.Trigger.Icon sf={{ default: "wallet.bifold", selected: "wallet.bifold.fill" }} />
        <NativeTabs.Trigger.Label>Payments</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile" disableAutomaticContentInsets contentStyle={{ backgroundColor: shell.canvas }}>
        <NativeTabs.Trigger.Icon sf="list.bullet" />
        <NativeTabs.Trigger.Label>Menu</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

/** Android: the JS tabs and their shelf, unchanged. */
function RenterJsTabs() {
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
