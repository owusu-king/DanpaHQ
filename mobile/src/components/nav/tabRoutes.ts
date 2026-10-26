import type { BottomTabBarProps } from "expo-router/tabs";
import { StyleSheet } from "react-native";

/**
 * Whether expo-router has taken this route out of the bar.
 *
 * `href: null` is the way to keep a route in the navigator and off the tab bar
 * — the provider's `add` screen. But **`href` never reaches a custom tab bar.**
 * expo-router destructures it away in `TabsClient` and marks the route two other
 * ways instead: `tabBarItemStyle: { display: "none" }`, and a `tabBarButton`
 * that renders `null`. The default bar honours it only because it renders that
 * button; anything custom has to read the marker.
 *
 * Reading `options.href` therefore matched nothing, and the provider grew a
 * sixth tab labelled from its filename.
 *
 * The `href` check stays as well, because the transform is skipped entirely when
 * a screen's `options` is a function — and then `href` *does* survive.
 */
export function isHiddenFromBar(options: BottomTabBarProps["descriptors"][string]["options"]): boolean {
  if ((options as { href?: string | null }).href === null) return true;
  return StyleSheet.flatten(options.tabBarItemStyle)?.display === "none";
}
