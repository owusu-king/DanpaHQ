import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useRef, useState } from "react";
import {
  LayoutAnimation,
  PanResponder,
  Pressable,
  StyleSheet,
  Switch,
  View,
  type AccessibilityActionEvent,
} from "react-native";

import { Type, motion, radius, space } from "@/components/ui";
import { useReduceMotion } from "@/motion";
import { hapticsPolicy, pressableFeedback } from "@/platform";
import { theme } from "@/theme";

/**
 * The rows Explore's filter sheet is made of.
 *
 * The sheet used to be a wall: two labelled rent fields, every property and unit
 * type as a chip — eleven of them for units — and the order as a list of rows. It
 * reached the status bar before anyone chose anything. Each question is now one
 * row with its answer on the same line: a range for rent, dropdowns for the longer
 * lists, a segmented choice for bedrooms and a switch for furnishing.
 */

/** Every row: a comfortable thumb target with its label and answer on one line. */
const ROW_HEIGHT = 56;
/** A thumb's touch circle, and the knob drawn inside it. */
const TOUCH = 48;
const KNOB = 26;
/** Segments are drawn 36pt tall and reach the 48pt floor with slop. */
const SEGMENT_SLOP = { top: 6, bottom: 6 };

/**
 * Monthly rent in whole cedis, as stops on the track: close together where most
 * rents are, further apart where few are. The first stop means no minimum and the
 * last no maximum.
 */
const RENT_STOPS = [0, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000];
const LAST = RENT_STOPS.length - 1;
const ADJUST = [{ name: "increment" }, { name: "decrement" }] as const;

export type FilterOption<T extends string> = { value: T; label: string };

const cedis = (amount: number) => `GH₵${amount.toLocaleString("en-GH")}`;
const stopAt = (index: number) => RENT_STOPS[index] ?? 0;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** The stop nearest a stored amount, so a value set anywhere else still lands on the track. */
function stopFor(amount: string, fallback: number) {
  const value = Number(amount);
  if (!amount || !Number.isFinite(value)) return fallback;
  return RENT_STOPS.reduce(
    (best, stop, index) => (Math.abs(stop - value) < Math.abs(stopAt(best) - value) ? index : best),
    0,
  );
}

/** What a stop means as a stored amount: an end of the track is no limit at all. */
const amountAt = (index: number, edge: number) => (index === edge ? "" : String(stopAt(index)));

/** A light tick as a thumb passes a stop, on iOS where haptics are precise. */
function tick() {
  if (!hapticsPolicy.onSelection) return;
  void import("expo-haptics")
    .then((haptics) => haptics.selectionAsync())
    .catch(() => null);
}

type Thumb = "low" | "high";

/**
 * Rent as one range: two thumbs on one track, from no minimum to no maximum.
 *
 * It replaced two labelled number fields, which needed a keyboard to answer and
 * two rows of the sheet to ask. The thumbs snap to stops, never cross, and say
 * what they mean as they move; the search runs once, when a thumb is let go,
 * rather than at every stop it passes. Each thumb is also a screen-reader
 * adjustable that steps one stop at a time.
 */
export function PriceRange({
  minimum,
  maximum,
  onChange,
}: {
  /** Whole cedis, or empty for no limit. */
  minimum: string;
  maximum: string;
  onChange: (minimum: string, maximum: string) => void;
}) {
  const committed = useMemo<[number, number]>(() => {
    const low = stopFor(minimum, 0);
    const high = stopFor(maximum, LAST);
    if (low < high) return [low, high];
    const safeLow = Math.min(low, LAST - 1);
    return [safeLow, Math.max(high, safeLow + 1)];
  }, [minimum, maximum]);
  const [drag, setDrag] = useState<{ thumb: Thumb; range: [number, number] } | null>(null);
  const [low, high] = drag?.range ?? committed;
  const [usable, setUsable] = useState(0);

  // Read inside the responders, which are made once.
  const live = useRef({ low, high, usable });
  live.current = { low, high, usable };
  const commit = useRef(onChange);
  commit.current = onChange;

  const responders = useMemo(() => {
    const responder = (thumb: Thumb) => {
      let origin = 0;
      let latest: [number, number] = [0, LAST];
      const settle = () => {
        setDrag(null);
        commit.current(amountAt(latest[0], 0), amountAt(latest[1], LAST));
      };
      return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          const current = live.current;
          latest = [current.low, current.high];
          origin = ((thumb === "low" ? current.low : current.high) / LAST) * current.usable;
          setDrag({ thumb, range: latest });
        },
        onPanResponderMove: (_, gesture) => {
          const width = Math.max(1, live.current.usable);
          const index = Math.round((clamp(origin + gesture.dx, 0, width) / width) * LAST);
          const next: [number, number] = thumb === "low"
            ? [Math.min(index, latest[1] - 1), latest[1]]
            : [latest[0], Math.max(index, latest[0] + 1)];
          if (next[0] === latest[0] && next[1] === latest[1]) return;
          latest = next;
          setDrag({ thumb, range: next });
          tick();
        },
        // A thumb keeps its drag, however far it strays from the track.
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: () => settle(),
        onPanResponderTerminate: () => settle(),
      });
    };
    return { low: responder("low"), high: responder("high") };
  }, []);

  const adjust = (thumb: Thumb, event: AccessibilityActionEvent) => {
    const step = event.nativeEvent.actionName === "increment" ? 1 : -1;
    const next: [number, number] = thumb === "low"
      ? [clamp(low + step, 0, high - 1), high]
      : [low, clamp(high + step, low + 1, LAST)];
    onChange(amountAt(next[0], 0), amountAt(next[1], LAST));
  };

  const readout = low === 0 && high === LAST
    ? "Any price"
    : low === 0
      ? `Up to ${cedis(stopAt(high))}`
      : high === LAST
        ? `From ${cedis(stopAt(low))}`
        : `${cedis(stopAt(low))} – ${cedis(stopAt(high))}`;
  const lowX = (low / LAST) * usable;
  const highX = (high / LAST) * usable;
  // Thumbs a stop apart overlap. The one being dragged is on top; otherwise the
  // one with more room to move is, so two thumbs at one end never trap each other.
  const top: Thumb = drag?.thumb ?? (low > LAST / 2 ? "low" : "high");

  const knob = (thumb: Thumb) => {
    const index = thumb === "low" ? low : high;
    const edge = thumb === "low" ? 0 : LAST;
    return (
      <View
        {...responders[thumb].panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={thumb === "low" ? "Minimum rent" : "Maximum rent"}
        accessibilityValue={{
          text: index === edge ? (thumb === "low" ? "No minimum" : "No maximum") : cedis(stopAt(index)),
        }}
        accessibilityActions={ADJUST}
        onAccessibilityAction={(event) => adjust(thumb, event)}
        // A real native view, so Android can stop the sheet's list from
        // intercepting the drag once the thumb holds it.
        collapsable={false}
        style={[styles.thumb, { left: thumb === "low" ? lowX : highX, zIndex: thumb === top ? 2 : 1 }]}
      >
        <View style={[styles.knob, drag?.thumb === thumb ? styles.knobHeld : null]} />
      </View>
    );
  };

  return (
    <View style={styles.price}>
      <View style={styles.priceHead}>
        <Type variant="body" style={styles.label}>Rent per month</Type>
        <Type variant="bodyStrong" style={styles.readout}>{readout}</Type>
      </View>
      <View
        style={styles.trackArea}
        onLayout={(event) => setUsable(Math.max(0, event.nativeEvent.layout.width - TOUCH))}
      >
        <View style={styles.track} />
        <View style={[styles.span, { left: TOUCH / 2 + lowX, width: Math.max(0, highX - lowX) }]} />
        {knob("low")}
        {knob("high")}
      </View>
    </View>
  );
}

/**
 * One answer from a list, as a dropdown that opens in place.
 *
 * The row names the question and shows the current answer in a field with a
 * chevron; a tap opens the options beneath it, the chosen one ticked in kola, and
 * a choice closes it again. Any answer other than the first — "Any", or the
 * default order — tints the field, so a sheet with filters set reads as set at a
 * glance. It opens in the flow of the sheet rather than floating over it, so it
 * can never be clipped by the sheet's edge or lose a touch on Android.
 */
export function SelectField<T extends string>({
  label,
  value,
  options,
  open,
  onToggle,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly FilterOption<T>[];
  open: boolean;
  onToggle: () => void;
  onChange: (value: T) => void;
}) {
  const reduceMotion = useReduceMotion();
  const current = options.find((option) => option.value === value) ?? options[0];
  const chosen = Boolean(current) && current !== options[0];
  const animate = () => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.create(motion.duration.base, "easeInEaseOut", "opacity"));
  };

  return (
    <View style={styles.ruled}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? ""}`}
        accessibilityHint={open ? "Hides the options" : "Shows the options"}
        aria-expanded={open}
        onPress={() => {
          animate();
          onToggle();
        }}
        {...pressableFeedback(theme.color.field["100"])}
        style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      >
        <Type variant="body" style={styles.label}>{label}</Type>
        <View style={[styles.select, chosen ? styles.selectChosen : null, open ? styles.selectOpen : null]}>
          <Type
            variant="captionStrong"
            numberOfLines={1}
            style={[styles.selectText, chosen ? styles.chosenText : null]}
          >
            {current?.label}
          </Type>
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={16}
            color={chosen || open ? theme.color.kola["600"] : theme.color.ink["500"]}
          />
        </View>
      </Pressable>
      {open ? (
        <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.menu}>
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <Pressable
                key={option.value || "any"}
                accessibilityRole="radio"
                aria-selected={selected}
                accessibilityLabel={option.label}
                onPress={() => {
                  animate();
                  onChange(option.value);
                }}
                {...pressableFeedback(theme.color.kola["50"])}
                style={({ pressed }) => [
                  styles.option,
                  index === 0 ? null : styles.optionRuled,
                  selected ? styles.optionChosen : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Type variant={selected ? "bodyStrong" : "body"} style={[styles.optionText, selected ? styles.chosenText : null]}>
                  {option.label}
                </Type>
                {selected ? <Ionicons name="checkmark" size={18} color={theme.color.kola["600"]} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A short set of answers side by side, as one segmented control.
 *
 * Every segment keeps a one-point edge whether it is chosen or not, so choosing
 * moves nothing: the chosen segment only changes colour, paper on the quiet fill
 * with a kola edge and kola type.
 */
export function SegmentedField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly FilterOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={[styles.row, styles.ruled, styles.wrap]}>
      <Type variant="body" style={styles.label}>{label}</Type>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.segments}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value || "any"}
              accessibilityRole="radio"
              aria-selected={selected}
              accessibilityLabel={`${label}: ${option.label}`}
              hitSlop={SEGMENT_SLOP}
              onPress={() => onChange(option.value)}
              style={[styles.segment, selected ? styles.segmentChosen : null]}
            >
              <Type variant="captionStrong" style={selected ? styles.chosenText : styles.segmentText}>
                {option.label}
              </Type>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * On or off, so a switch — the platform's own, in kola. The whole row is the
 * target, so the switch takes no touches of its own and cannot toggle twice.
 */
export function ToggleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      aria-checked={value}
      accessibilityLabel={label}
      onPress={() => onChange(!value)}
      style={[styles.row, styles.ruled]}
    >
      <Type variant="body" style={styles.label}>{label}</Type>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Switch
          value={value}
          trackColor={{ false: theme.color.field["300"], true: theme.color.kola["600"] }}
          thumbColor={theme.color.field["0"]}
          ios_backgroundColor={theme.color.field["300"]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.field["200"],
  },
  wrap: {
    flexWrap: "wrap",
    paddingVertical: space[2],
  },
  pressed: {
    opacity: 0.72,
  },
  label: {
    flexShrink: 1,
    color: theme.color.ink["900"],
  },
  chosenText: {
    color: theme.color.kola["800"],
  },
  price: {
    paddingTop: space[3],
    paddingBottom: space[1],
  },
  priceHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space[3],
  },
  readout: {
    flexShrink: 1,
    textAlign: "right",
    color: theme.color.kola["800"],
  },
  // Pulled out by the difference between the touch circle and the knob, so the
  // knobs' outer edges line up with the text above them.
  trackArea: {
    height: TOUCH,
    marginHorizontal: -(TOUCH - KNOB) / 2,
  },
  track: {
    position: "absolute",
    top: TOUCH / 2 - 2,
    left: TOUCH / 2,
    right: TOUCH / 2,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.color.field["200"],
  },
  span: {
    position: "absolute",
    top: TOUCH / 2 - 2,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.color.kola["600"],
  },
  thumb: {
    position: "absolute",
    top: 0,
    width: TOUCH,
    height: TOUCH,
    alignItems: "center",
    justifyContent: "center",
  },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    borderWidth: 2,
    borderColor: theme.color.kola["600"],
    backgroundColor: theme.color.field["0"],
    shadowColor: theme.color.kola["900"],
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  knobHeld: {
    transform: [{ scale: 1.12 }],
  },
  select: {
    minHeight: 40,
    maxWidth: "62%",
    flexDirection: "row",
    alignItems: "center",
    gap: space[1] + 2,
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.color.field["300"],
    backgroundColor: theme.color.field["0"],
  },
  selectChosen: {
    borderColor: theme.color.kola["600"],
    backgroundColor: theme.color.kola["50"],
  },
  selectOpen: {
    borderColor: theme.color.kola["600"],
  },
  selectText: {
    flexShrink: 1,
    color: theme.color.ink["900"],
  },
  menu: {
    marginBottom: space[3],
    overflow: "hidden",
    borderRadius: radius.md + 2,
    borderWidth: 1,
    borderColor: theme.color.field["200"],
    backgroundColor: theme.color.field["0"],
  },
  option: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
  },
  optionRuled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.field["200"],
  },
  optionChosen: {
    backgroundColor: theme.color.kola["50"],
  },
  optionText: {
    flex: 1,
    color: theme.color.ink["900"],
  },
  segments: {
    flexDirection: "row",
    gap: 2,
    padding: 3,
    borderRadius: radius.md,
    backgroundColor: theme.color.field["100"],
  },
  segment: {
    minWidth: 44,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[3],
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  segmentChosen: {
    backgroundColor: theme.color.field["0"],
    borderColor: theme.color.kola["600"],
  },
  segmentText: {
    color: theme.color.ink["700"],
  },
});
