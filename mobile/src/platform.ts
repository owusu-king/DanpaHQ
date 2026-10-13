/**
 * Platform differences, in one place.
 *
 * The brief is that Android and iOS are both first-class, and that where they
 * differ we should follow each platform rather than force one behaviour on both.
 * That is a design position, not a shrug: a user should not be able to tell that
 * this app shares a codebase.
 *
 * Every entry below is a real convention difference, with the reason recorded so
 * a future change is a decision rather than a drift.
 */

import { BottomTabBarHeightContext } from "expo-router/tabs";
import { useContext } from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const isAndroid = Platform.OS === "android";
export const isIOS = Platform.OS === "ios";

/**
 * A breath between the status bar and a header's controls on Android (owner,
 * 2026-10-07): fitted exactly to the inset, they sat against the clock. iOS
 * already leaves this room under its own status bar.
 */
export const ANDROID_HEADER_BREATH = isAndroid ? 8 : 0;

/**
 * The space interactive header content must keep above itself: the safe-area
 * inset, plus the Android breath above.
 *
 * The inset is how far the status bar actually overlaps this app. Drawn edge to
 * edge it is the bar's height; on a phone where the app starts below the bar —
 * a Galaxy S10+ in Expo Go, say — it is zero, because nothing overlaps.
 *
 * It used to fall back to `StatusBar.currentHeight` when the inset read zero,
 * and before that to take the larger of the two. Both added a status bar's worth
 * of empty green over every header on exactly those phones, with the controls
 * pushed to its foot (owner, 2026-10-07).
 */
export const safeHeaderTop = (safeAreaTop: number) =>
  Math.max(0, safeAreaTop) + ANDROID_HEADER_BREATH;

/**
 * The room a scrolling page keeps under its last row — `safeHeaderTop`'s twin.
 *
 * Android draws edge-to-edge, so its navigation buttons sit *over* the bottom of
 * the page: a list that pads by a fixed amount runs its final row underneath
 * them, and the buttons read as though the content were showing through. iOS
 * does the same under the home indicator.
 *
 * The inset is added to the page's own breathing room rather than replacing it,
 * so a device with neither still gets a deliberate-looking gap.
 */
export function useSafeBottom(base: number) {
  const insets = useSafeAreaInsets();
  const floatingBar = useFloatingTabBarClearance();
  // The floating bar already stands above the home indicator, so its height
  // replaces the inset rather than adding to it.
  if (floatingBar > 0) return base + floatingBar;
  return base + insets.bottom;
}

/**
 * How much of a tab screen the iOS glass tab bar covers, home indicator
 * included — zero on Android, whose bar sits in the layout below the page, and
 * on every pushed screen, which has no tab bar at all.
 *
 * Use it for anything pinned to a tab screen's foot, so it rides above the
 * glass rather than under it.
 */
export function useFloatingTabBarClearance() {
  const tabBarHeight = useContext(BottomTabBarHeightContext);
  return isIOS && tabBarHeight ? tabBarHeight : 0;
}

export const platformName = Platform.select({ android: "android", ios: "ios", default: "web" });

/**
 * OTP autofill.
 *
 * The two platforms read one-time codes completely differently:
 *
 * - **iOS** parses the SMS itself and offers the code above the keyboard when the
 *   input declares `textContentType="oneTimeCode"`. No app permission, no
 *   message format requirement.
 * - **Android** uses the SMS Retriever API, which requires an 11-character app
 *   hash appended to the message and delivers the code through a broadcast. The
 *   `autoComplete="sms-otp"` hint drives the keyboard suggestion path, which is
 *   what works without the hash.
 *
 * Getting this wrong is not cosmetic. On a cheap phone, switching to the SMS app
 * to read a code and back is where sign-ups are abandoned.
 */
export const otpInputProps = Platform.select({
  ios: { textContentType: "oneTimeCode" as const, keyboardType: "number-pad" as const },
  android: { autoComplete: "sms-otp" as const, keyboardType: "number-pad" as const },
  default: { keyboardType: "number-pad" as const },
});

export const phoneInputProps = Platform.select({
  ios: { textContentType: "telephoneNumber" as const, keyboardType: "phone-pad" as const },
  android: { autoComplete: "tel" as const, keyboardType: "phone-pad" as const },
  default: { keyboardType: "phone-pad" as const },
});

/**
 * Navigation transitions.
 *
 * iOS users expect a horizontal push with an interactive swipe-back edge gesture;
 * taking that away feels broken. Android's system convention is a subtler fade
 * plus the hardware/gesture back, and a horizontal slide there reads as an iOS
 * port.
 */
export const stackAnimation = Platform.select({
  ios: "slide_from_right" as const,
  android: "fade_from_bottom" as const,
  default: "fade" as const,
});

export const gestureBackEnabled = isIOS;

/**
 * Destructive confirmations.
 *
 * iOS convention is an action sheet from the bottom with a red destructive row.
 * Android convention is a centred dialog with text buttons. `Alert` maps to the
 * right native presentation on each, so the shared call still produces the
 * correct-feeling result.
 */
export const destructiveConfirmStyle = Platform.select({
  ios: "destructive" as const,
  android: "default" as const,
  default: "default" as const,
});

/**
 * Elevation.
 *
 * The design system uses hairline borders rather than shadows, partly because
 * soft shadows smear on the low-cost LCD panels that dominate the Android base
 * here. iOS devices in the same market are typically newer with better panels,
 * so a *very* subtle shadow is affordable there and reads as native. Android
 * keeps the border.
 */
export const surfaceElevation = Platform.select({
  ios: {
    shadowColor: "#101A17",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  android: { elevation: 0 },
  default: {},
});

/**
 * Haptics.
 *
 * iOS haptics are precise and expected at confirmation points. Android's
 * vibration motor quality varies enormously across the price range this product
 * targets, and a coarse buzz on a cheap handset feels like a malfunction rather
 * than feedback, so Android gets haptics only for errors.
 */
export const hapticsPolicy = {
  onSuccess: isIOS,
  onError: true,
  onSelection: isIOS,
};

/**
 * Typography.
 *
 * iOS Dynamic Type is a system-level accessibility promise and must be honoured.
 * Android font scaling is honoured too but capped: at 2x, dense record rows
 * break their layout on a 5-inch screen, and an unreadable layout serves nobody.
 */
export const maxFontSizeMultiplier = isIOS ? 2.0 : 1.6;

/**
 * How a control answers a press: the same on both platforms (owner,
 * 2026-09-28). This used to give Android an `android_ripple`, often in the
 * control's full ink, and Android draws that ripple across the view's
 * rectangle whatever its corners and whatever it clips — so a tap on a rounded
 * button flashed a dark box over it ("Join a home", the start screen's cards).
 * Every control already carries its own pressed style, which is now applied on
 * Android too. The colour is kept in the signature so the call sites still say
 * which tint the control belongs to.
 */
export const pressableFeedback = (_color: string) => ({});
