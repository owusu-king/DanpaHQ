import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import {
  Easing,
  FadeInDown,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type WithSpringConfig,
  type WithTimingConfig,
} from "react-native-reanimated";

import { motion } from "@/components/ui";

/**
 * The app's motion language.
 *
 * Every duration and curve here comes from `components/ui`, which reads them
 * from the generated theme, which is compiled from the same `tokens.json` the
 * web reads. Nothing in this file invents a number: a screen that wants to move
 * something asks for `enter` or `exit`, and what those mean stays a change to
 * the design system rather than to a hundred and sixteen screens.
 *
 * The three curves are not interchangeable. `enter` decelerates, so something
 * arriving is worth watching. `exit` accelerates, so something leaving gets out
 * of the way. `standard` is for a change of state that is neither.
 */

/**
 * Whether this person has asked the system to reduce motion.
 *
 * **This is for structural decisions, not for animation configs.** The configs
 * below carry `ReduceMotion.System`, which Reanimated honours on the UI thread
 * without asking JavaScript — so an animation that runs through `enter()` or
 * `press` is already answered and does not need this hook.
 *
 * What it is still for is the question a config cannot answer: whether to start
 * an animation *at all*. The home skeleton's pulse is the case — Reduce Motion
 * holds it at a legible opacity rather than removing the block, and no timing
 * config can express "do not loop".
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

/**
 * The duration scale, re-exported so a screen needs one motion import.
 *
 * It lives in `components/ui` because that is where the generated theme is
 * parsed out of its CSS-shaped strings, but a screen reaching into the UI
 * module for a number and this module for a curve is how the two halves of one
 * animation end up disagreeing.
 */
export const duration = motion.duration;

/* Built once, at module scope. `Easing.bezier` compiles a curve; calling it per
   animation would rebuild the same three curves on every press and every tab
   change. */
const curve = {
  enter: Easing.bezier(...motion.easing.enter),
  exit: Easing.bezier(...motion.easing.exit),
  standard: Easing.bezier(...motion.easing.standard),
};

/** Something arriving. Decelerates, so the end of it is what you watch. */
export function enter(duration: number = motion.duration.base): WithTimingConfig {
  return { duration, easing: curve.enter, reduceMotion: ReduceMotion.System };
}

/** Something leaving. Accelerates, so it is out of the way before it is gone. */
export function exit(duration: number = motion.duration.fast): WithTimingConfig {
  return { duration, easing: curve.exit, reduceMotion: ReduceMotion.System };
}

/** A change of state that is neither an arrival nor a departure. */
export function standard(duration: number = motion.duration.base): WithTimingConfig {
  return { duration, easing: curve.standard, reduceMotion: ReduceMotion.System };
}

/**
 * The press response, everywhere one exists.
 *
 * A spring rather than a curve, because a thumb is a physical thing and the
 * control should answer like one — but a tight, nearly critically damped one.
 * Overshoot on a navigation target reads as a toy, and on a 4.5in Android at
 * 60Hz a bouncy spring is where dropped frames become visible.
 *
 * This is the tab bar's spring, which the header button already copied by hand.
 */
export const press: WithSpringConfig = {
  stiffness: 320,
  damping: 26,
  mass: 0.7,
  // Never let a press overshoot past its own bounds — see above.
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
};

/**
 * How far a pressed control shrinks.
 *
 * Two numbers, because scale is proportional and a press should not be. Eight
 * percent off a 24pt glyph is about two points of travel, which is the amount
 * that reads as a button going down. Eight percent off a half-width tile is
 * nearer eleven, which reads as the card being squashed — so a tile moves the
 * same couple of points, which at its size is three percent.
 */
export const PRESS_SCALE = 0.92;
export const PRESS_SCALE_TILE = 0.97;

/* --- arriving and leaving ------------------------------------------------ */

/**
 * How long each section waits behind the one above it.
 *
 * Small on purpose. A stagger is meant to make a screen resolve top-down
 * instead of blinking into existence all at once; past roughly 60ms per row it
 * stops reading as one screen arriving and starts reading as a list being dealt
 * out, and the last card is late for no reason a person would thank you for.
 */
const STAGGER = 45;

/** The furthest a section travels on arrival. Reanimated's own default is 25. */
const RISE = 10;

/**
 * A section arriving on a screen that has finished loading.
 *
 * Home used to swap a pulsing skeleton for the real dashboard between one frame
 * and the next: three grey blocks, then five cards at their full height, with
 * the page under them jumping to the new length. Everything was correct and
 * nothing was smooth — the most common complaint about the screen was that it
 * "flashed".
 *
 * `order` is the section's place down the screen, not an index into a list.
 * Pass it so the screen resolves in reading order.
 *
 * Reduce Motion is not an argument here: `BaseAnimationBuilder` defaults to
 * `ReduceMotion.System`, so an entering animation is skipped to its final
 * values on a device that asked for that, and the card is simply *there*.
 */
export function arrive(order = 0) {
  return FadeInDown.duration(motion.duration.base)
    .easing(curve.enter)
    .delay(order * STAGGER)
    // Reanimated's 25pt is a card sliding in. Ten is a card settling.
    .withInitialValues({ opacity: 0, transform: [{ translateY: RISE }] });
}

/**
 * Something being replaced by what it was standing in for.
 *
 * Deliberately shorter than `arrive` and on the accelerating curve: the
 * skeleton's job ends the moment the real thing exists, so it should be gone
 * before the reader has decided to look at it.
 */
export function depart() {
  return FadeOut.duration(motion.duration.fast).easing(curve.exit);
}

/**
 * The pulse a loading skeleton breathes with.
 *
 * Both Homes draw blocks in the shape of what is coming, and until now only one
 * of them moved: the tenant's pulsed between 0.45 and 1, the provider's sat at a
 * flat 0.7. One read as loading and the other as a rendering fault.
 *
 * Reduce Motion is answered here rather than by `ReduceMotion.System`, because
 * the system's answer is "hold it at its starting value" and this animation's
 * starting value is its faintest — a block dim enough to read as disabled. What
 * somebody who turned motion off should get is the shape, still and fully
 * legible, so the decision is not to start the loop at all.
 */
export function useSkeletonPulse() {
  const opacity = useSharedValue(0.45);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 0.75;
      return;
    }
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, standard(duration.slow)),
        withTiming(0.45, standard(duration.slow)),
      ),
      // Forever, and not mirrored — the sequence already contains its return.
      -1,
      false,
    );
  }, [opacity, reduceMotion]);

  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}
