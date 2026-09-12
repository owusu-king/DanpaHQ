import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * What this device should be called in somebody's list of signed-in devices.
 *
 * "mobile" is not a device. The list exists so a person can recognise the phone
 * in their hand — and, more to the point, fail to recognise one they have never
 * held. A platform name tells them neither, and every Android and iPhone they
 * have ever signed in on reads identically.
 *
 * The name the person gave their phone is the best answer we can give ("Ama's
 * iPhone"): they chose it, so they know it. Android reports its model when
 * there is no such name; iOS does not expose one, so it falls back to the
 * system version, which still distinguishes two sign-ins a year apart.
 */
export function describeDevice(): string {
  const named = Constants.deviceName?.trim();

  if (Platform.OS === "android") {
    const constants = Platform.constants as { Model?: string; Release?: string };
    const system = constants.Release ? `Android ${constants.Release}` : "Android";
    const model = constants.Model?.trim();
    return [named || model, system].filter(Boolean).join(" · ");
  }

  const system = `iOS ${Platform.Version}`;
  return named ? `${named} · ${system}` : system;
}
