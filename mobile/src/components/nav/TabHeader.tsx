import type { BottomTabHeaderProps } from "@react-navigation/bottom-tabs";
import { getHeaderTitle } from "@react-navigation/elements";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderChromeBackground } from "@/components/nav/HeaderChromeBackground";
import { space } from "@/components/ui";
import { safeHeaderTop } from "@/platform";
import { shell } from "@/shell";

/** Compact chrome around 40pt controls, without sacrificing their touch area. */
const ROW_HEIGHT = 56;
const NARROW_ROW_HEIGHT = 52;
const NARROW_WIDTH = 360;

/**
 * The top of every tab: the page's name, on Rooomly's green.
 *
 * The header used to stand on the page's own ground, which made header, page and
 * tab bar one flat surface — calm, with nothing to say which part was which. It
 * is the chrome now (`shell.chrome`): a kola band from the top of the glass to
 * the bottom of the title row, with the name in white, so the page below reads
 * as the thing being framed.
 *
 * The earlier refinements hold. The name is said here once and the page opens
 * with what it is for; the row is compact and steps down on the narrowest
 * handsets; and on Android the status bar's measured height is the band's floor.
 *
 * - A tab whose page names itself with its content passes a `headerTitle`
 *   function — both Homes pass the wordmark — which is drawn in the title's place.
 * - With no title and no controls, the header is only the band behind the status
 *   bar and a breath beneath it.
 */
export function TabHeader({
  options,
  route,
}: BottomTabHeaderProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const narrow = width <= NARROW_WIDTH;
  // Android is edge-to-edge. A few older/smaller devices report a zero safe
  // inset during navigator layout even though the native status bar is still
  // occupying space. Its measured height is the floor, never extra padding.
  const topInset = safeHeaderTop(insets.top);
  const tintColor = shell.onChrome;
  const customTitle = typeof options.headerTitle === "function"
    ? options.headerTitle({ children: options.title ?? route.name, tintColor })
    : null;
  const title = customTitle ? "" : getHeaderTitle(options, route.name);
  const left = options.headerLeft?.({ tintColor }) ?? null;
  const right = options.headerRight?.({ tintColor, canGoBack: false }) ?? null;

  if (!customTitle && !title && !left && !right) {
    // A breath under the status bar, so a page that names itself does not start
    // against the clock.
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
      <HeaderChromeBackground />
      <View
        style={[
          styles.row,
          narrow ? styles.rowNarrow : null,
          {
            paddingLeft: left ? 0 : narrow ? space[4] : space[5],
            paddingRight: right ? 0 : narrow ? space[4] : space[5],
          },
        ]}
      >
        {left}
        <View style={[styles.identity, left ? { paddingLeft: narrow ? space[2] : space[3] } : null]}>
          {customTitle ?? (title ? (
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              maxFontSizeMultiplier={1.25}
              style={[styles.title, narrow ? styles.titleNarrow : null]}
            >
              {title}
            </Text>
          ) : null)}
        </View>
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space[1],
  },
  rowNarrow: {
    minHeight: NARROW_ROW_HEIGHT,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  // A compact navigation title, stepping down again on the narrowest handsets.
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: shell.onChrome,
  },
  titleNarrow: {
    fontSize: 18,
    lineHeight: 24,
  },
});
