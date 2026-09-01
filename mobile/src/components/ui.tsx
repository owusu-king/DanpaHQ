/**
 * Mobile design-system primitives, from the shared Daylight & Ledger tokens.
 *
 * Every component here honours the platform module: touch targets, feedback,
 * font scaling and elevation all follow the host convention rather than a
 * single blended one.
 */

import { forwardRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  View,
  type ViewProps,
} from "react-native";

import {
  hapticsPolicy,
  maxFontSizeMultiplier,
  pressableFeedback,
  surfaceElevation,
} from "@/platform";
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

type TypeName = "display2" | "title1" | "title2" | "body" | "bodyStrong" | "caption" | "label" | "mono";

const TYPE: Record<TypeName, object> = {
  display2: { fontSize: 32, lineHeight: 36, fontWeight: "600", color: theme.color.ink["900"] },
  title1: { fontSize: 24, lineHeight: 30, fontWeight: "600", color: theme.color.ink["900"] },
  title2: { fontSize: 20, lineHeight: 26, fontWeight: "600", color: theme.color.ink["900"] },
  body: { fontSize: 16, lineHeight: 24, color: theme.color.ink["900"] },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: theme.color.ink["900"] },
  caption: { fontSize: 14, lineHeight: 20, color: theme.color.ink["500"] },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    letterSpacing: 1,
    color: theme.color.ink["500"],
  },
  mono: { fontSize: 14, lineHeight: 20, fontFamily: "monospace", color: theme.color.ink["900"] },
};

export function Type({
  variant = "body",
  style,
  ...props
}: TextProps & { variant?: TypeName }) {
  return (
    <Text
      {...props}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[TYPE[variant], style]}
    />
  );
}

export function Surface({ style, ...props }: ViewProps) {
  return <View {...props} style={[styles.surface, surfaceElevation, style]} />;
}

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
  variant?: "primary" | "secondary" | "quiet" | "destructive";
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
      primary: { bg: theme.color.kola["600"], fg: theme.color.field["0"], border: theme.color.kola["600"] },
      secondary: { bg: theme.color.field["0"], fg: theme.color.ink["900"], border: theme.color.field["300"] },
      quiet: { bg: "transparent", fg: theme.color.kola["600"], border: "transparent" },
      destructive: { bg: theme.color.field["0"], fg: theme.color.laterite["600"], border: theme.color.laterite["600"] },
    }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole={selected === undefined ? "button" : "checkbox"}
      accessibilityState={{
        disabled: inactive,
        busy,
        ...(selected === undefined ? null : { checked: selected }),
      }}
      accessibilityLabel={busy ? busyLabel : label}
      {...pressableFeedback(theme.color.kola["300"])}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border },
        selected ? { borderWidth: 2 } : null,
        // iOS gets the opacity press state it expects; Android has the ripple.
        pressed && !inactive ? { opacity: 0.85 } : null,
        inactive ? { opacity: 0.5 } : null,
      ]}
    >
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
          <View style={styles.inputPrefix}>
            <Type variant="body" style={{ color: theme.color.ink["500"] }}>
              {prefix}
            </Type>
          </View>
        ) : null}
        <TextInput
          ref={ref}
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
      accessibilityState={
        role === "radio" ? { selected, disabled } : { checked: selected, disabled }
      }
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
    borderRadius: 8,
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
