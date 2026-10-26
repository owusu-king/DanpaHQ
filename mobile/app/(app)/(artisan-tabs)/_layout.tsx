import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";

import { MainTabBar } from "@/components/nav/MainTabBar";
import { nativeTabHaptics } from "@/components/nav/NativeTabFrame";
import { TabHeader } from "@/components/nav/TabHeader";
import { ArtisanHeaderActions } from "@/components/nav/TabHeaderControls";
import { isIOS } from "@/platform";
import { shell } from "@/shell";
import { theme } from "@/theme";

/**
 * The artisan experience: four tabs and no others — Home, Requests, Jobs and
 * My Profile. An artisan sees the work they were invited to or given, never a
 * tenant, a property or a request beyond it. Switching back to renting or
 * managing lives on My Profile, as it lives on Menu elsewhere.
 *
 * Route names carry an `artisan-` prefix because a group adds nothing to the
 * URL: a bare `profile` here would share an address with the renter's Menu.
 */
export default function ArtisanTabsLayout() {
  return isIOS ? <ArtisanNativeTabs /> : <ArtisanJsTabs />;
}

/** iOS: Apple's own bar, as the renter and provider have it. Each page draws its row in `ArtisanTabFrame`. */
function ArtisanNativeTabs() {
  return (
    <NativeTabs tintColor={theme.color.kola["600"]} screenListeners={nativeTabHaptics}>
      <NativeTabs.Trigger name="index" disableAutomaticContentInsets contentStyle={{ backgroundColor: shell.dashboard }}>
        <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="artisan-requests" disableAutomaticContentInsets contentStyle={{ backgroundColor: shell.canvas }}>
        <NativeTabs.Trigger.Icon sf={{ default: "doc.text", selected: "doc.text.fill" }} />
        <NativeTabs.Trigger.Label>Requests</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="artisan-jobs" disableAutomaticContentInsets contentStyle={{ backgroundColor: shell.canvas }}>
        <NativeTabs.Trigger.Icon sf={{ default: "wrench.and.screwdriver", selected: "wrench.and.screwdriver.fill" }} />
        <NativeTabs.Trigger.Label>Jobs</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="artisan-profile" disableAutomaticContentInsets contentStyle={{ backgroundColor: shell.canvas }}>
        <NativeTabs.Trigger.Icon sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }} />
        <NativeTabs.Trigger.Label>My Profile</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

/** Android: the JS tabs and their shelf, as everywhere else. */
function ArtisanJsTabs() {
  return (
    <Tabs
      tabBar={(props) => <MainTabBar {...props} />}
      screenOptions={{
        header: (props) => <TabHeader {...props} />,
        headerRight: () => <ArtisanHeaderActions />,
        sceneStyle: { backgroundColor: shell.canvas },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", headerShadowVisible: false, sceneStyle: { backgroundColor: shell.dashboard }, tabBarLabel: "Home", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "home" : "home-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="artisan-requests" options={{ title: "Requests", tabBarLabel: "Requests", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "document-text" : "document-text-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="artisan-jobs" options={{ title: "Jobs", tabBarLabel: "Jobs", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "construct" : "construct-outline"} color={color} size={size} /> }} />
      <Tabs.Screen name="artisan-profile" options={{ title: "My Profile", tabBarLabel: "My Profile", tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "person-circle" : "person-circle-outline"} color={color} size={size} /> }} />
    </Tabs>
  );
}
