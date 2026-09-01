import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Whether this person has asked the system to reduce motion.
 *
 * Every animation in the app owes them an answer. It lived inside the tab bar
 * until the home skeleton needed the same question, and a second copy of an
 * accessibility check is a second place for it to be forgotten.
 *
 * Subscribed rather than read once: the setting can change while the app is
 * open, and an animation that keeps moving after somebody turns it off is worse
 * than one that never honoured it, because they have just told it to stop.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
