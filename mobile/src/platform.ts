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

import { Platform } from "react-native";

export const isAndroid = Platform.OS === "android";
export const isIOS = Platform.OS === "ios";

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

/** Android needs explicit ripple config; iOS uses opacity on press. */
export const pressableFeedback = (color: string) =>
  isAndroid ? { android_ripple: { color, borderless: false } } : {};

/**
 * The status bar sits over the app on Android and needs explicit background
 * handling; iOS handles it through the safe area.
 */
export const needsStatusBarBackground = isAndroid;
