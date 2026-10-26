import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  useSafeAreaInsets,
  type EdgeInsets,
} from "react-native-safe-area-context";

/**
 * A safe-area context for the window a `Modal` opens in.
 *
 * A React Native `Modal` is a separate native window. The `SafeAreaProvider` at
 * the app root measures the page *behind* the modal, so a sheet that reads
 * `useSafeAreaInsets()` from outside is reading someone else's window — and on
 * Android, where Expo SDK 54 draws edge-to-edge, the two windows disagree about
 * where the navigation buttons are.
 *
 * The symptom is the giveaway: the sheet's footer sits under the navigation
 * buttons while the page behind it is correctly inset, and after a re-render the
 * two swap over. One provider cannot describe two windows.
 *
 * So every `Modal` gets its own. `initialMetrics` seeds it with the app's first
 * measurement — the same screen, so a good first guess — which avoids a frame of
 * zero inset before the modal's own window is measured.
 */
export function ModalSafeArea({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics} style={styles.fill}>
      {children}
    </SafeAreaProvider>
  );
}

/**
 * The bottom inset of whichever window this is rendered in.
 *
 * A render prop rather than a hook, so it can be dropped inside a `Modal`'s
 * provider without restructuring the component that owns the modal's state.
 * The caller decides what to do with the number: a footer wants at least its
 * own padding (`Math.max`), a scrolling body wants its padding *and* the inset.
 */
export function SafeBottom({ render }: { render: (bottom: number) => ReactNode }) {
  const insets = useSafeAreaInsets();
  return <>{render(insets.bottom)}</>;
}

/**
 * Every edge of whichever window this is rendered in.
 *
 * For a sheet that has to know about more than one edge — its footer clears the
 * navigation buttons, and its height is capped below the status bar — so that
 * both numbers come from the same window rather than one from each.
 */
export function SafeInsets({ render }: { render: (edges: EdgeInsets) => ReactNode }) {
  const insets = useSafeAreaInsets();
  return <>{render(insets)}</>;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
