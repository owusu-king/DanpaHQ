/**
 * Mobile design-system primitives, from the shared Daylight & Ledger tokens.
 *
 * Every component here honours the platform module: touch targets, feedback,
 * font scaling and elevation all follow the host convention rather than a
 * single blended one.
 */

import { createContext, forwardRef, useContext, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  useWindowDimensions,
  View,
  type ViewProps,
} from "react-native";

import {
  hapticsPolicy,
  maxFontSizeMultiplier,
  pressableFeedback,
  surfaceElevation,
} from "@/platform";
import { Sheen } from "@/components/Sheen";
import { theme } from "@/theme";

const px = (value: string) => Number(value.replace("px", ""));

export const space = {
  1: px(theme.space["1"]),
  2: px(theme.space["2"]),
  3: px(theme.space["3"]),
  4: px(theme.space["4"]),
  5: px(theme.space["5"]),
  6: px(theme.space["6"]),
  8: px(theme.space["8"]),
  10: px(theme.space["10"]),
  12: px(theme.space["12"]),
};

export const radius = {
  sm: px(theme.radius.sm),
  md: px(theme.radius.md),
  lg: px(theme.radius.lg),
  pill: px(theme.radius.pill),
};

/**
 * The shared motion tokens, in the units React Native animates in.
 *
 * The design system has carried these since it was written and mobile had never
 * read them — every screen picked its own milliseconds, and the tab bar happened
 * to hardcode `220`, `140` and two bezier curves that are character-for-character
 * the tokens below. Duplicated constants agree right up until one of them is
 * revised.
 *
 * The three curves say different things and are not interchangeable: `enter`
 * decelerates, so something arriving is worth watching; `exit` accelerates, so
 * something leaving gets out of the way; `standard` is for a change of state
 * that is neither.
 */
const bezier = (value: string) =>
  value
    .replace(/^cubic-bezier\(/, "")
    .replace(/\)$/, "")
    .split(",")
    .map((part) => Number(part.trim())) as [number, number, number, number];

const ms = (value: string) => Number(value.replace("ms", ""));

export const motion = {
  duration: {
    instant: ms(theme.motion.duration.instant),
    fast: ms(theme.motion.duration.fast),
    base: ms(theme.motion.duration.base),
    slow: ms(theme.motion.duration.slow),
  },
  easing: {
    standard: bezier(theme.motion.easing.standard),
    enter: bezier(theme.motion.easing.enter),
    exit: bezier(theme.motion.easing.exit),
  },
};

/**
 * The type scale, derived from the shared tokens rather than restated here.
 *
 * These sizes used to be hardcoded, which is how mobile came to be a version
 * behind the design system without anything failing: `display2` was 32px here
 * and 40px in tokens.json, and nothing existed that could notice.
 *
 * The public names stay camelCase because a hundred and sixteen screens call
 * them, and a rename buys nothing a mapping does not.
 */
type TypeName =
  | "display1" | "display2" | "display3"
  | "title1" | "title2"
  | "bodyLg" | "body" | "bodyStrong"
  | "caption" | "captionStrong"
  | "label"
  | "amountXl" | "amountLg" | "amount"
  | "mono";

const TOKEN_KEY: Record<TypeName, keyof typeof theme.type> = {
  display1: "display-1",
  display2: "display-2",
  display3: "display-3",
  title1: "title-1",
  title2: "title-2",
  bodyLg: "body-lg",
  body: "body",
  bodyStrong: "body-strong",
  caption: "caption",
  captionStrong: "caption-strong",
  label: "label",
  amountXl: "amount-xl",
  amountLg: "amount-lg",
  amount: "amount",
  mono: "code",
};

/**
 * Mobile sets its own weights (owner, 2026-10-06): the clean, regular look of
 * the More page everywhere, with bold kept for where it is needed — headlines
 * and the figures a page is about. Emphasis below a headline is medium, not
 * semibold. Web keeps the tokens' weights.
 */
const WEIGHT: Record<TypeName, "400" | "500" | "600"> = {
  display1: "600",
  display2: "600",
  display3: "600",
  title1: "600",
  title2: "500",
  bodyLg: "400",
  body: "400",
  bodyStrong: "500",
  caption: "400",
  captionStrong: "500",
  label: "500",
  amountXl: "600",
  amountLg: "600",
  amount: "500",
  mono: "500",
};

/** Secondary text is muted; everything else carries full ink. */
const MUTED: ReadonlySet<TypeName> = new Set<TypeName>(["caption", "captionStrong", "label"]);

const buildType = (name: TypeName) => {
  const token = theme.type[TOKEN_KEY[name]];
  const fontSize = px(token.size);
  // Tracking is authored in em, which React Native does not accept; it wants
  // absolute points, so it is resolved against the size it belongs to.
  const em = Number(token.tracking.replace("em", ""));
  return {
    fontSize,
    lineHeight: px(token.lineHeight),
    fontWeight: WEIGHT[name],
    letterSpacing: Number((em * fontSize).toFixed(2)),
    color: MUTED.has(name) ? theme.color.ink["500"] : theme.color.ink["900"],
    // Present only for the display face. Body text is deliberately left to the
    // platform, and an undefined fontFamily is how React Native is told so.
    ...("fontFamily" in token ? { fontFamily: token.fontFamily as string } : null),
  };
};

const TYPE = Object.fromEntries(
  (Object.keys(TOKEN_KEY) as TypeName[]).map((name) => [name, buildType(name)]),
) as Record<TypeName, object>;

type TypeDensity = "regular" | "compact" | "narrow";

const TypeDensityContext = createContext<TypeDensity>("regular");

/**
 * One window subscription for the whole app, rather than one per text node.
 * Portrait phones at 375dp and below receive a deliberately bounded type scale;
 * 340dp-class devices step down once more. Touch targets and layout dimensions
 * are unchanged, and system font scaling is still applied after these bases.
 */
export function TypographyScaleProvider({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const density: TypeDensity = width <= 340 ? "narrow" : width <= 375 ? "compact" : "regular";
  return <TypeDensityContext.Provider value={density}>{children}</TypeDensityContext.Provider>;
}

type TypeMeasure = readonly [fontSize: number, lineHeight: number];

const COMPACT_MEASURE: Record<TypeName, TypeMeasure> = {
  display1: [44, 48],
  display2: [34, 38],
  display3: [28, 34],
  title1: [22, 27],
  title2: [19, 25],
  bodyLg: [17, 26],
  body: [15, 23],
  bodyStrong: [15, 23],
  caption: [13, 19],
  captionStrong: [13, 19],
  label: [11, 15],
  amountXl: [34, 38],
  amountLg: [25, 30],
  amount: [15, 21],
  mono: [13, 19],
};

const NARROW_MEASURE: Record<TypeName, TypeMeasure> = {
  display1: [40, 44],
  display2: [31, 35],
  display3: [26, 31],
  title1: [21, 26],
  title2: [18, 24],
  bodyLg: [16, 24],
  body: [15, 22],
  bodyStrong: [15, 22],
  caption: [13, 18],
  captionStrong: [13, 18],
  label: [10.5, 14],
  amountXl: [31, 35],
  amountLg: [24, 29],
  amount: [15, 20],
  mono: [13, 18],
};

const buildDensityType = (measure: Record<TypeName, TypeMeasure>) =>
  Object.fromEntries(
    (Object.keys(measure) as TypeName[]).map((name) => {
      const [fontSize, lineHeight] = measure[name];
      const token = theme.type[TOKEN_KEY[name]];
      const em = Number(token.tracking.replace("em", ""));
      return [name, {
        fontSize,
        lineHeight,
        letterSpacing: Number((em * fontSize).toFixed(2)),
      }];
    }),
  ) as Record<TypeName, object>;

const COMPACT_TYPE = buildDensityType(COMPACT_MEASURE);
const NARROW_TYPE = buildDensityType(NARROW_MEASURE);

export function Type({
  variant = "body",
  style,
  ...props
}: TextProps & { variant?: TypeName }) {
  const density = useContext(TypeDensityContext);
  const responsiveType = density === "narrow"
    ? NARROW_TYPE[variant]
    : density === "compact"
      ? COMPACT_TYPE[variant]
      : null;

  return (
    <Text
      {...props}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[TYPE[variant], responsiveType, style]}
    />
  );
}

export function Surface({ style, ...props }: ViewProps) {
  return <View {...props} style={[styles.surface, surfaceElevation, style]} />;
}

/**
 * White at an opacity. Local rather than `alpha` from `@/shell`, which imports
 * the home plinth, which imports this file: a cycle that would load half-made.
 */
const white = (opacity: number) => `rgba(255, 255, 255, ${opacity})`;

export function Button({
  label,
  onPress,
  variant = "primary",
  busy = false,
  disabled = false,
  busyLabel = "Working…",
  icon,
  selected,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "quiet" | "accent" | "destructive";
  busy?: boolean;
  disabled?: boolean;
  busyLabel?: string;
  icon?: ReactNode;
  /**
   * Present when the button is a toggle rather than an action.
   *
   * A tick in the label reads correctly by eye and says nothing to a screen
   * reader, so a button used as a choice announces itself as a checkbox and
   * carries its own on/off state.
   */
  selected?: boolean;
}) {
  const inactive = busy || disabled;
  const palette = selected
    // A chosen option has to look chosen. `selected` used to change only the
    // accessibility state, so a picked filter rendered identically to an
    // unpicked one and nothing about tapping it looked like a choice.
    ? { bg: theme.color.kola["50"], fg: theme.color.kola["600"], border: theme.color.kola["600"] }
    : {
      // The app's one button language (owner, 2026-09-28), shared with the
      // sheets and the tab bar: deep kola glass for the act that moves things
      // on — white reads at 9:1 on it — frosted white glass for the one beside
      // it, kola words alone for a quiet act, and a laterite wash for one that
      // removes. Each pill catches light along its top and has a thin rim.
      primary: { bg: theme.color.kola["800"], fg: theme.color.field["0"], border: white(0.34) },
      secondary: { bg: white(0.82), fg: theme.color.kola["800"], border: theme.color.field["200"] },
      quiet: { bg: "transparent", fg: theme.color.kola["800"], border: "transparent" },
      accent: { bg: theme.color.gold["500"], fg: theme.color.ink["950"], border: white(0.34) },
      destructive: { bg: theme.color.laterite["100"], fg: theme.color.laterite["600"], border: theme.color.laterite["100"] },
    }[variant];
  // Glass has light in it; a quiet act and a warning do not.
  const sheen = !selected && (variant === "primary" || variant === "accent")
    ? { from: 0.22, to: 0 }
    : !selected && variant === "secondary"
      ? { from: 0.9, to: 0.2 }
      : null;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole={selected === undefined ? "button" : "checkbox"}
      aria-disabled={inactive}
      aria-busy={busy}
      aria-checked={selected}
      accessibilityLabel={busy ? busyLabel : label}
      {...pressableFeedback(palette.fg)}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border },
        selected ? { borderWidth: 2 } : null,
        // One press state on both platforms: Android's ripple ignored the pill's corners.
        pressed && !inactive ? { opacity: 0.85 } : null,
        inactive ? { opacity: 0.5 } : null,
      ]}
    >
      {sheen ? <Sheen from={sheen.from} to={sheen.to} /> : null}
      {busy ? (
        <View style={styles.busyRow}>
          <ActivityIndicator size="small" color={palette.fg} />
          <Type variant="bodyStrong" style={{ color: palette.fg, flexShrink: 1, textAlign: "center" }}>
            {busyLabel}
          </Type>
        </View>
      ) : (
        <View style={styles.buttonContent}>
          {icon}
          <Type variant="bodyStrong" style={{ color: palette.fg, flexShrink: 1, textAlign: "center" }}>
            {label}
          </Type>
        </View>
      )}
    </Pressable>
  );
}

export const Field = forwardRef<TextInput, TextInputProps & {
  label: string;
  hint?: string;
  error?: string;
  prefix?: string;
  /**
   * A control that belongs to the field rather than beside it — revealing a
   * password, clearing a search. It sits inside the frame, so it moves with the
   * focus ring and cannot be mistaken for the next thing on the page.
   */
  suffix?: ReactNode;
}>(function Field({ label, hint, error, prefix, suffix, style, onFocus, onBlur, ...props }, ref) {
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInput>(null);
  useImperativeHandle(ref, () => input.current as TextInput);

  return (
    <View style={{ gap: space[2] }}>
      <Type variant="caption" style={{ color: theme.color.ink["700"] }}>
        {label}
      </Type>
      {/* The ring is a padded box behind the shell rather than a shadow, which
          is the one thing React Native will not give us in the same shape on
          both platforms. Negative margin keeps it out of the layout, so a field
          gaining focus moves nothing around it — the same promise the web makes
          with a spread box-shadow. */}
      <View
        style={{
          margin: -3,
          padding: 3,
          borderRadius: radius.md + 3,
          backgroundColor: focused
            ? error
              ? theme.color.laterite["100"]
              : theme.color.kola["50"]
            : "transparent",
        }}
      >
        <View
          style={[
            styles.inputShell,
            {
              borderColor: error
                ? theme.color.laterite["600"]
                : focused
                  ? theme.color.kola["600"]
                  : theme.color.field["300"],
            },
          ]}
        >
        {prefix ? (
          // A tap on "+233" or "GH₵" is a tap on the field, and the prefix is
          // set in the input's own size so the two share a baseline.
          <Pressable accessible={false} onPress={() => input.current?.focus()} style={styles.inputPrefix}>
            <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={styles.inputPrefixText}>
              {prefix}
            </Text>
          </Pressable>
        ) : null}
        <TextInput
          ref={input}
          {...props}
          accessibilityLabel={label}
          accessibilityHint={hint}
          maxFontSizeMultiplier={maxFontSizeMultiplier}
          placeholderTextColor={theme.color.ink["300"]}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, prefix ? { paddingLeft: 0 } : null, style]}
        />
        {suffix ? <View style={styles.inputSuffix}>{suffix}</View> : null}
        </View>
      </View>
      {error ? (
        <Type
          variant="caption"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={{ color: theme.color.laterite["600"] }}
        >
          {error}
        </Type>
      ) : hint ? (
        <Type variant="caption">{hint}</Type>
      ) : null}
    </View>
  );
});

/**
 * The Stamp, on mobile.
 *
 * Same rule as on the web: it always says what was checked and when, and "Not
 * checked" is shown as plainly as "Verified". The accessibility label reads the
 * whole thing as one sentence, because a screen-reader user should not have to
 * assemble the meaning from three fragments.
 */
export function Stamp({
  state,
  what,
  on,
  compact = false,
}: {
  state: "verified" | "pending" | "unverified" | "expired";
  what: string;
  on?: string;
  compact?: boolean;
}) {
  const tone = {
    verified: { label: "Verified", fg: theme.color.kola["600"], bg: theme.color.kola["50"], rule: theme.color.kola["300"] },
    pending: { label: "Check in progress", fg: theme.color.harmattan["600"], bg: theme.color.harmattan["100"], rule: theme.color.harmattan["500"] },
    unverified: { label: "Not checked", fg: theme.color.ink["500"], bg: theme.color.field["100"], rule: theme.color.field["300"] },
    expired: { label: "Check out of date", fg: theme.color.laterite["600"], bg: theme.color.laterite["100"], rule: theme.color.laterite["600"] },
  }[state];

  return (
    <View
      accessible
      accessibilityLabel={`${what}: ${tone.label}${on ? `, ${on}` : ""}`}
      style={[
        styles.stamp,
        { backgroundColor: tone.bg, borderLeftColor: tone.rule },
        compact ? { paddingVertical: space[1] } : null,
      ]}
    >
      <Type variant="label" style={{ color: tone.fg }}>
        {tone.label.toUpperCase()}
      </Type>
      <Type variant="caption" style={{ color: theme.color.ink["700"] }}>
        {what}
        {on ? ` · ${on}` : ""}
      </Type>
    </View>
  );
}

export function Notice({
  tone = "info",
  title,
  body,
}: {
  tone?: "info" | "warning" | "error" | "success";
  title: string;
  body?: string;
}) {
  const palette = {
    info: { bg: theme.color.lagoon["100"], rule: theme.color.lagoon["600"] },
    warning: { bg: theme.color.harmattan["100"], rule: theme.color.harmattan["500"] },
    error: { bg: theme.color.laterite["100"], rule: theme.color.laterite["600"] },
    success: { bg: theme.color.kola["50"], rule: theme.color.kola["600"] },
  }[tone];

  return (
    <View
      accessible
      accessibilityRole={tone === "error" ? "alert" : "summary"}
      accessibilityLiveRegion={tone === "error" ? "assertive" : "polite"}
      style={[styles.notice, { backgroundColor: palette.bg, borderLeftColor: palette.rule }]}
    >
      <Type variant="bodyStrong">{title}</Type>
      {body ? <Type variant="caption" style={{ marginTop: space[1] }}>{body}</Type> : null}
    </View>
  );
}


/**
 * Pick one from a short list.
 *
 * Built rather than reached for because there was nothing: the property form
 * asked for its type as free text, which is how a property ends up typed
 * `appartment`. A row of pills suits three or four options, keeps every choice
 * visible — no hidden picker to open — and each one is a full 48px target.
 *
 * For longer lists this is the wrong control, and that is deliberate: it should
 * look wrong before it is used for twenty things.
 */
export function Choice<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  value: T | "";
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: space[2] }}>
      {/* Sentence case, and the same caption the web labels a field with. It
          was shouted in capitals here and nowhere else. */}
      <Type variant="caption" style={{ color: theme.color.ink["700"] }}>
        {label}
      </Type>
      {hint ? <Type variant="caption">{hint}</Type> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {options.map((option) => (
          <SelectableChip
            key={option.value}
            label={option.label}
            selected={option.value === value}
            disabled={disabled}
            role="radio"
            onPress={() => onChange(option.value)}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * One of a set, chosen or not.
 *
 * Selected used to be a solid kola fill with white text, which reads as a row of
 * primary buttons — five things all asking to be pressed — rather than as one of
 * them being the answer. It is the web's chip language instead: a tinted ground,
 * a green edge, the label in kola. Quieter, and still obvious at a glance.
 *
 * The edge doubles rather than the colour merely changing, because state carried
 * by colour alone is state some people cannot see. The horizontal padding gives
 * back exactly what the second pixel of border takes, so a chip turning on does
 * not shove the chips after it onto another line.
 */
function SelectableChip({
  label,
  selected,
  disabled,
  role,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  role: "radio" | "checkbox";
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={role}
      aria-selected={role === "radio" ? selected : undefined}
      aria-checked={role === "radio" ? undefined : selected}
      aria-disabled={disabled}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        minHeight: theme.targetMin,
        justifyContent: "center",
        paddingHorizontal: selected ? space[4] - 1 : space[4],
        borderRadius: radius.pill,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.color.kola["600"] : theme.color.field["300"],
        backgroundColor: selected ? theme.color.kola["50"] : theme.color.field["0"],
        opacity: disabled ? 0.55 : pressed ? 0.7 : 1,
      })}
    >
      <Type
        variant={selected ? "bodyStrong" : "body"}
        style={{ color: selected ? theme.color.kola["800"] : theme.color.ink["900"] }}
      >
        {label}
      </Type>
    </Pressable>
  );
}

/** Several out of a set — an amenity, an attribute. */
export function Chip({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <SelectableChip
      label={label}
      selected={selected}
      disabled={disabled}
      role="checkbox"
      onPress={onPress}
    />
  );
}

export { hapticsPolicy };

const styles = StyleSheet.create({
  surface: {
    backgroundColor: theme.color.field["0"],
    borderWidth: 1,
    borderColor: theme.color.field["200"],
    borderRadius: 8,
    padding: space[4],
  },
  button: {
    minHeight: theme.targetMin,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    overflow: "hidden",
  },
  busyRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  buttonContent: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
  },
  inputShell: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: theme.targetMin,
    backgroundColor: theme.color.field["0"],
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: theme.color.ink["900"],
    paddingHorizontal: space[3],
  },
  inputPrefix: { justifyContent: "center", paddingLeft: space[3], paddingRight: space[2] },
  inputPrefixText: { fontSize: 16, includeFontPadding: false, color: theme.color.ink["500"] },
  inputSuffix: { justifyContent: "center", paddingRight: space[2] },
  stamp: {
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: 2,
    borderLeftWidth: 3,
    gap: space[1],
  },
  notice: {
    padding: space[4],
    borderRadius: 2,
    borderLeftWidth: 3,
  },
});
