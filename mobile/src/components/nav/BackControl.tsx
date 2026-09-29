import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { type ColorValue, Pressable, View } from "react-native";

import { useAuth } from "@/auth";
import { resolveEntryRoute } from "@/navigation";
import { pressableFeedback } from "@/platform";
import { shell } from "@/shell";

/**
 * The way out of any screen that a tab does not hold open.
 *
 * The native back button only renders when the stack has somewhere to go back
 * to, and several routes here arrive with an empty one. `router.replace` from a
 * tab drops the tabs out of the stack entirely — the Tenancy requests screen is
 * reached that way from `?view=requests` — so the screen opened with no back
 * button *and* no tab bar. On iOS, where there is no hardware back, that is a
 * dead end; on Android the system button leaves the app.
 *
 * So this never asks only "can I go back". When there is history it goes back,
 * and when there is none it goes home — to the same entry route the app resolves
 * at sign-in, which is the tenant or provider surface this person actually uses.
 * Either way there is a way out, which is the whole point of the control.
 *
 * It also replaces the platform back button rather than sitting beside it, so
 * one shape means "leave this screen" everywhere. iOS otherwise labels it with
 * the previous screen's title, which changes with the route you came from and
 * truncates to "‹ Back" or "‹ Tenancy re..." depending on the journey.
 *
 * It takes the header's tint — white on the kola chrome — rather than a colour of
 * its own, so it can never be the one dark glyph on a coloured band.
 */
export function BackControl({
  canGoBack,
  mode = "back",
  tintColor,
}: {
  /** Passed by react-navigation. Authoritative: it knows this screen's index. */
  canGoBack?: boolean;
  /** A modal is dismissed rather than returned from, so it reads as a close. */
  mode?: "back" | "close";
  /** The header's tint, passed through `headerLeft`. */
  tintColor?: ColorValue;
}) {
  const router = useRouter();
  const { state, activeContext } = useAuth();

  const leave = () => {
    if (canGoBack ?? router.canGoBack()) {
      router.back();
      return;
    }
    const home =
      state.status === "signed_in"
        ? resolveEntryRoute(state.me, activeContext)
        : "/(app)/(tabs)";
    router.replace(home as never);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={mode === "close" ? "Close" : "Go back"}
      onPress={leave}
      // The icon is 26pt inside a 44pt target: the smallest thing a thumb can
      // reliably hit, and the one measurement that decides whether a header
      // control feels considered or fiddly.
      hitSlop={8}
      {...pressableFeedback(shell.chromeRaised)}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        opacity: pressed ? 0.55 : 1,
      })}
    >
      <View
        pointerEvents="none"
        style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
      >
        <Ionicons
          name={mode === "close" ? "close" : "chevron-back"}
          size={26}
          color={tintColor ?? shell.onChrome}
        />
      </View>
    </Pressable>
  );
}

/** `headerLeft` for an ordinary pushed screen. */
export const backHeaderLeft = (props: { canGoBack?: boolean; tintColor?: ColorValue }) => (
  <BackControl canGoBack={props.canGoBack} tintColor={props.tintColor} />
);

/** `headerLeft` for a modal, which is dismissed rather than returned from. */
export const closeHeaderLeft = (props: { canGoBack?: boolean; tintColor?: ColorValue }) => (
  <BackControl canGoBack={props.canGoBack} tintColor={props.tintColor} mode="close" />
);
