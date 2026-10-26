import type { BottomTabHeaderProps } from "expo-router/tabs";
import type { ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderChromeBackground } from "@/components/nav/HeaderChromeBackground";
import { space } from "@/components/ui";
import { isAndroid, safeHeaderTop } from "@/platform";
import { shell } from "@/shell";

/** Compact chrome around 40pt controls, without sacrificing their touch area. */
// Shorter on Android, where the status bar above it already adds a band of
// green (owner, 2026-10-06/07): the 40pt discs with 4pt above and below, no more.
const ROW_HEIGHT = isAndroid ? 48 : 58;
const NARROW_ROW_HEIGHT = isAndroid ? 48 : 54;
const NARROW_WIDTH = 360;

/**
 * The top of every tab: a tool row on Danpa HQ's textured green.
 *
 * It does not name the page. The tab bar already says where you are, and the
 * page opens with what it is for, so a title here was a third copy. The row is
 * the workspace's tools in fixed places, the way a banking app's header is:
 *
 * - `headerLeft` on the leading side (you, or the Portfolio),
 * - `headerTitle`, when it is a function, drawn in the middle (the tenant's
 *   search pill) — a string title is never drawn,
 * - `headerRight` on the trailing side (the bell, and anything the tab adds).
 *
 * The two sides share the spare width equally, so the middle stays centred
 * whichever side is busier. On Android the status bar's measured height is the
 * band's floor. With no controls at all, the header is only the band behind the
 * status bar and a breath beneath it.
 */
export function TabHeader({
  options,
  route,
}: BottomTabHeaderProps) {
  const tintColor = shell.onChrome;
  const middle = typeof options.headerTitle === "function"
    ? options.headerTitle({ children: options.title ?? route.name, tintColor })
    : null;
  const left = options.headerLeft?.({ tintColor }) ?? null;
  const right = options.headerRight?.({ tintColor, canGoBack: false }) ?? null;
  // A Home hero carries the green on down, so the header draws no edge and only
  // its upper band: the hero draws the lower one, and the two read as one piece.
  const continues = options.headerShadowVisible === false;

  return <TabHeaderRow left={left} middle={middle} right={right} continues={continues} />;
}

/**
 * The row itself, from its three slots.
 *
 * Split from `TabHeader` so the iOS native tabs — which draw no header of their
 * own — can put the same row at the top of each page (`NativeTabFrame`).
 */
export function TabHeaderRow({
  left,
  middle,
  right,
  continues = false,
}: {
  left?: ReactNode;
  middle?: ReactNode;
  right?: ReactNode;
  continues?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const narrow = width <= NARROW_WIDTH;
  // Android is edge-to-edge. A few older/smaller devices report a zero safe
  // inset during navigator layout even though the native status bar is still
  // occupying space. Its measured height is the floor, never extra padding.
  const topInset = safeHeaderTop(insets.top);

  if (!middle && !left && !right) {
    // A breath under the status bar, so a page does not start against the clock.
    return (
      <View style={{ height: topInset + space[2], backgroundColor: shell.chrome }}>
        <HeaderChromeBackground />
      </View>
    );
  }

  return (
    <View
      style={{
        paddingTop: topInset,
        paddingLeft: insets.left,
        paddingRight: insets.right,
        backgroundColor: shell.chrome,
      }}
    >
      <HeaderChromeBackground edge={!continues} leading={!continues} />
      <View style={[styles.row, narrow ? styles.rowNarrow : null]}>
        <View style={[styles.side, middle ? styles.sideShared : styles.sideOwn]}>{left}</View>
        {middle}
        <View style={[styles.side, middle ? styles.sideShared : null, styles.trailing]}>{right}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: isAndroid ? 0 : space[1],
  },
  rowNarrow: {
    minHeight: NARROW_ROW_HEIGHT,
  },
  side: {
    flexDirection: "row",
    alignItems: "center",
  },
  // With a middle, both sides take equal shares so it sits on the centre line.
  sideShared: {
    flex: 1,
    flexBasis: 0,
  },
  // Without one, the leading side may use whatever the trailing tools leave.
  sideOwn: {
    flex: 1,
    minWidth: 0,
  },
  trailing: {
    justifyContent: "flex-end",
  },
});
