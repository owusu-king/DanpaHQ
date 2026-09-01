import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";

import { useAuth } from "@/auth";
import { space } from "@/components/ui";
import { resolveEntryRoute } from "@/navigation";
import { isAndroid, pressableFeedback } from "@/platform";
import { theme } from "@/theme";

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
 */
export function BackControl({
  canGoBack,
  mode = "back",
}: {
  /** Passed by react-navigation. Authoritative: it knows this screen's index. */
  canGoBack?: boolean;
  /** A modal is dismissed rather than returned from, so it reads as a close. */
  mode?: "back" | "close";
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
      {...pressableFeedback(theme.color.field["200"])}
      style={({ pressed }) => ({
        minWidth: 44,
        minHeight: 44,
        alignItems: "flex-start",
        justifyContent: "center",
        // Android draws its own left padding; iOS needs the control flush with
        // where the native button sat, or every header shifts by a few points.
        paddingLeft: isAndroid ? 0 : 2,
        paddingRight: space[2],
        opacity: pressed && !isAndroid ? 0.55 : 1,
      })}
    >
      <View>
        <Ionicons
          name={mode === "close" ? "close" : "chevron-back"}
          size={26}
          color={theme.color.kola["600"]}
        />
      </View>
    </Pressable>
  );
}

/** `headerLeft` for an ordinary pushed screen. */
export const backHeaderLeft = (props: { canGoBack?: boolean }) => (
  <BackControl canGoBack={props.canGoBack} />
);

/** `headerLeft` for a modal, which is dismissed rather than returned from. */
export const closeHeaderLeft = (props: { canGoBack?: boolean }) => (
  <BackControl canGoBack={props.canGoBack} mode="close" />
);
