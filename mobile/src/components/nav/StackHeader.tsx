import type { NativeStackHeaderProps } from "expo-router";
import { getHeaderTitle } from "expo-router/react-navigation";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderChromeBackground } from "@/components/nav/HeaderChromeBackground";
import { space } from "@/components/ui";
import { safeHeaderTop } from "@/platform";
import { shell } from "@/shell";

const ROW_HEIGHT = 52;
const NARROW_ROW_HEIGHT = 48;
const NARROW_WIDTH = 360;

/**
 * Header for screens pushed above either tab workspace.
 *
 * Native Stack's default Android header and the custom tab header did not share
 * the same edge-to-edge boundary. On devices that briefly report a zero inset,
 * pushed-screen titles could sit behind the system status indicators. This
 * component gives both header families the same measured safe-area contract.
 *
 * It is the same kola chrome as the tabs' header, with the title and the way back
 * in white, so moving deeper into a record keeps the frame and changes only what
 * is inside it.
 */
export function StackHeader({ options, route, back }: NativeStackHeaderProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const narrow = width <= NARROW_WIDTH;
  const topInset = safeHeaderTop(insets.top);
  const title = getHeaderTitle(options, route.name);
  const tintColor = options.headerTintColor ?? shell.onChrome;
  const canGoBack = Boolean(back);
  const left = options.headerLeft?.({
    tintColor,
    canGoBack,
    label: back?.title,
  }) ?? null;
  const right = options.headerRight?.({ tintColor, canGoBack }) ?? null;

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
      <View style={[styles.row, narrow ? styles.rowNarrow : null]}>
        {left}
        <View style={[styles.identity, left ? styles.identityAfterControl : null]}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            maxFontSizeMultiplier={1.25}
            style={[styles.title, narrow ? styles.titleNarrow : null]}
          >
            {title}
          </Text>
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
    paddingHorizontal: space[4],
    paddingVertical: space[1],
  },
  rowNarrow: {
    minHeight: NARROW_ROW_HEIGHT,
    paddingHorizontal: space[3],
  },
  identity: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  identityAfterControl: {
    paddingLeft: space[2],
  },
  title: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "700",
    letterSpacing: -0.1,
    color: shell.onChrome,
  },
  titleNarrow: {
    fontSize: 16,
    lineHeight: 22,
  },
});

/**
 * How tall this header draws, for a screen that has to clear it — a
 * `KeyboardAvoidingView` on iOS measures from the window, not from under the
 * header, so a composer at the foot of a chat would stop short by this much.
 */
export function useStackHeaderHeight(): number {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  return safeHeaderTop(insets.top) + (width <= NARROW_WIDTH ? NARROW_ROW_HEIGHT : ROW_HEIGHT);
}
