import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from "react-native";

import { apiFetch, ApiFailure } from "@/api";
import type { Me } from "@/auth";
import { SuccessMark, tick } from "@/components/auth/AuthMotion";
import { CodeCells } from "@/components/auth/AuthScene";
import { ph, useHomeDensity } from "@/components/home/plinth";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { SheetCard, SheetGlassButton, SheetPrimaryButton } from "@/components/sheet/SheetParts";
import { Notice, Type, space } from "@/components/ui";
import { fieldErrorsFrom } from "@/formErrors";
import { isAndroid, maxFontSizeMultiplier, pressableFeedback } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * The parts the profile page is made of.
 *
 * Every row is the same shape — its name on the leading side, its value on the
 * trailing — inside its own frosted panel, with space between fields and
 * section headings keeping related facts together. What
 * differs is only what touching the value does: type into it, choose from a
 * list, step a count, answer yes or no, or open the email sheet.
 */

const WHITE = theme.color.field["0"];
const DEEP = theme.color.kola["900"];
const INK = theme.color.ink["900"];
const KOLA = theme.color.kola["600"];
const GOLD = theme.color.gold["600"];

const GLASS = alpha(WHITE, 0.72);
const GLASS_EDGE = alpha(DEEP, 0.08);
const FOCUS = alpha(KOLA, 0.06);
export const META = alpha(INK, 0.7);
const PLACEHOLDER = alpha(INK, 0.42);
const PANEL_RADIUS = 16;

/** A group's name, small and quiet, above its fields. */
export function SectionTitle({ children, aside }: { children: string; aside?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <Type variant="captionStrong" accessibilityRole="header" style={{ color: theme.color.ink["700"] }}>
        {children}
      </Type>
      {aside}
    </View>
  );
}

/** Related fields, each on its own frosted surface with the login field spacing. */
export function GlassPanel({ children }: { children: ReactNode }) {
  const rows = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View style={{ gap: space[3] }}>
      {rows.map((child, index) => (
        <View key={index} style={[styles.panel, isAndroid ? null : styles.panelLift]}>
          <View style={{ borderRadius: PANEL_RADIUS - 1, overflow: "hidden" }}>
            {child}
          </View>
        </View>
      ))}
    </View>
  );
}

function useLabelWidth() {
  const density = useHomeDensity();
  return density.veryCompact ? 96 : density.compact ? 104 : 112;
}

/** A value you type, its label beside it rather than above, so several fit in a glance. */
export function FieldRow({
  label,
  onFocus,
  onBlur,
  multiline,
  ...input
}: TextInputProps & { label: string }) {
  const density = useHomeDensity();
  const width = useLabelWidth();
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.row, multiline ? styles.rowTall : null, focused ? { backgroundColor: FOCUS } : null]}>
      <Type
        variant="caption"
        style={[styles.rowLabel, multiline ? { paddingTop: space[3] } : null, { width, color: focused ? theme.color.kola["800"] : META }]}
      >
        {label}
      </Type>
      <TextInput
        autoCapitalize="words"
        {...input}
        multiline={multiline}
        accessibilityLabel={label}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        placeholderTextColor={PLACEHOLDER}
        selectionColor={KOLA}
        cursorColor={KOLA}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          { fontSize: density.compact ? 15 : 15.5 },
          multiline ? { minHeight: 76, textAlignVertical: "top" } : null,
        ]}
      />
    </View>
  );
}

/** A fact that is shown here but changed somewhere else, or not at all. */
export function ReadRow({ label, value, note }: { label: string; value: string; note?: string }) {
  const width = useLabelWidth();
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}${note ? `. ${note}` : ""}`}>
      <Type variant="caption" style={[styles.rowLabel, { width, color: META }]}>
        {label}
      </Type>
      <View style={{ flex: 1, paddingVertical: space[3], gap: 1 }}>
        <Type variant="body" style={{ color: INK }}>
          {value}
        </Type>
        {note ? (
          <Type variant="caption" style={{ color: theme.color.ink["500"] }}>
            {note}
          </Type>
        ) : null}
      </View>
      <Ionicons name="lock-closed" size={13} color={alpha(INK, 0.35)} />
    </View>
  );
}

/** A value that opens something: its current state, and a chevron. */
export function ActionRow({
  label,
  value,
  placeholder,
  badge,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  badge?: ReactNode;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const width = useLabelWidth();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label}: ${value || placeholder || ""}`}
      {...pressableFeedback(FOCUS)}
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: FOCUS } : null]}
    >
      <Type variant="caption" style={[styles.rowLabel, { width, color: META }]}>
        {label}
      </Type>
      <View style={{ flex: 1, paddingVertical: space[3], gap: 4, alignItems: "flex-start" }}>
        <Type variant="body" numberOfLines={1} style={{ color: value ? INK : PLACEHOLDER }}>
          {value || placeholder}
        </Type>
        {badge}
      </View>
      <Ionicons name="chevron-forward" size={16} color={alpha(DEEP, 0.3)} />
    </Pressable>
  );
}

/** A small status mark under a value: confirmed, or waiting on the person. */
export function StatusBadge({ tone, label }: { tone: "good" | "waiting"; label: string }) {
  const good = tone === "good";
  return (
    <View style={[styles.badge, { backgroundColor: good ? theme.color.kola["50"] : theme.color.gold["50"] }]}>
      <Ionicons name={good ? "checkmark-circle" : "alert-circle"} size={12} color={good ? KOLA : GOLD} />
      <Type variant="captionStrong" style={{ fontSize: 11.5, lineHeight: 15, color: good ? theme.color.kola["800"] : theme.color.gold["700"] }}>
        {label}
      </Type>
    </View>
  );
}

/** A choice from a short list, opened in a sheet. */
export function ChoiceRow<T extends string>({
  label,
  value,
  options,
  placeholder = "Choose",
  onChange,
}: {
  label: string;
  value: T | "";
  options: { value: T; label: string }[];
  placeholder?: string;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <>
      <ActionRow label={label} value={current?.label} placeholder={placeholder} onPress={() => setOpen(true)} />
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label} closeLabel={`Close ${label.toLowerCase()}`}>
        <SheetCard padded={false}>
          {options.map((option, index) => {
            const on = option.value === value;
            return (
              <Pressable
                key={option.value}
                onPress={() => {
                  tick();
                  onChange(option.value);
                  setOpen(false);
                }}
                accessibilityRole="radio"
                aria-checked={on}
                {...pressableFeedback(FOCUS)}
                style={[styles.option, index ? styles.optionRuled : null, on ? { backgroundColor: theme.color.kola["50"] } : null]}
              >
                <Type variant={on ? "bodyStrong" : "body"} style={{ flex: 1, color: on ? theme.color.kola["800"] : INK }}>
                  {option.label}
                </Type>
                <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={20} color={on ? KOLA : alpha(DEEP, 0.25)} />
              </Pressable>
            );
          })}
        </SheetCard>
      </BottomSheet>
    </>
  );
}

/** Yes, no, or not said — two small pills, and tapping the lit one unsets it. */
export function YesNoRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
}) {
  const width = useLabelWidth();
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Type variant="caption" style={[styles.rowLabel, { width, color: META }]}>
        {label}
      </Type>
      <View style={styles.pills}>
        {([true, false] as const).map((answer) => {
          const on = value === answer;
          return (
            <Pressable
              key={String(answer)}
              onPress={() => {
                tick();
                onChange(on ? null : answer);
              }}
              accessibilityRole="radio"
              aria-checked={on}
              accessibilityLabel={`${label}: ${answer ? "yes" : "no"}`}
              style={[styles.pill, on ? styles.pillOn : null]}
            >
              <Type variant={on ? "captionStrong" : "caption"} style={{ color: on ? WHITE : theme.color.ink["700"] }}>
                {answer ? "Yes" : "No"}
              </Type>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A small count, stepped rather than typed. Empty until first touched. */
export function StepperRow({
  label,
  value,
  min = 1,
  max = 20,
  onChange,
}: {
  label: string;
  value: number | null;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const width = useLabelWidth();
  const shown = value ?? 0;
  const step = (delta: number) => {
    tick();
    onChange(Math.max(min, Math.min(max, (value ?? min - delta) + delta)));
  };
  return (
    <View style={styles.row}>
      <Type variant="caption" style={[styles.rowLabel, { width, color: META }]}>
        {label}
      </Type>
      <View style={{ flex: 1 }} />
      {/* Not answered yet is its own state, not a dash between two buttons. */}
      {value === null ? (
        <Pressable
          onPress={() => {
            tick();
            onChange(min);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Add ${label.toLowerCase()}`}
          style={[styles.pill, styles.addPill]}
        >
          <Ionicons name="add" size={15} color={KOLA} />
          <Type variant="captionStrong" style={{ color: theme.color.kola["800"] }}>
            Add
          </Type>
        </Pressable>
      ) : (
      <View style={styles.stepper} accessible accessibilityRole="adjustable" accessibilityLabel={`${label}: ${value ?? "not set"}`}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => step(event.nativeEvent.actionName === "increment" ? 1 : -1)}
      >
        <Pressable onPress={() => step(-1)} disabled={value === null || shown <= min} hitSlop={6} style={styles.stepButton} accessibilityLabel={`Fewer`}>
          <Ionicons name="remove" size={16} color={value === null || shown <= min ? alpha(INK, 0.25) : KOLA} />
        </Pressable>
        <Type variant="bodyStrong" style={styles.stepValue}>
          {value ?? "–"}
        </Type>
        <Pressable onPress={() => step(1)} disabled={shown >= max} hitSlop={6} style={styles.stepButton} accessibilityLabel={`More`}>
          <Ionicons name="add" size={16} color={shown >= max ? alpha(INK, 0.25) : KOLA} />
        </Pressable>
      </View>
      )}
    </View>
  );
}

type Started = { verification_id: string; email: string; expires_in: number; resend_in: number };

/**
 * Adding, changing or confirming an email address.
 *
 * Three moments in one sheet, so it never feels like leaving the page: the
 * address, the six digits sent to it, and the tick. The address joins the
 * account only on the tick — until then whatever was there before stays — and
 * the sheet says so, because "I typed it, why is it not there?" is the obvious
 * question otherwise.
 */
export function EmailSheet({
  visible,
  onClose,
  current,
  verified,
  onChanged,
}: {
  visible: boolean;
  onClose: () => void;
  current: string | null;
  verified: boolean;
  /** The account after the address was confirmed or removed. */
  onChanged: (me: Me | null) => Promise<void> | void;
}) {
  const [step, setStep] = useState<"address" | "code" | "done">("address");
  const [email, setEmail] = useState(current ?? "");
  const [started, setStarted] = useState<Started | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const codeRef = useRef<TextInput>(null);

  // Opening the sheet starts from the top. An unconfirmed address on file is
  // offered as-is, so confirming it is one tap. Only *opening* resets it: the
  // account refreshes the moment a code is confirmed, and resetting on that
  // would throw the person back to the address instead of showing the tick.
  const currentRef = useRef(current);
  currentRef.current = current;
  useEffect(() => {
    if (!visible) return;
    setStep("address");
    setEmail(currentRef.current ?? "");
    setStarted(null);
    setCode("");
    setError("");
  }, [visible]);

  useEffect(() => {
    if (step !== "code") return;
    const timer = setInterval(() => setResendIn((value) => Math.max(value - 1, 0)), 1000);
    return () => clearInterval(timer);
  }, [step]);

  async function send() {
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<Started>("/me/email/", { method: "POST", body: { email: email.trim() } });
      setStarted(result);
      setResendIn(result.resend_in);
      setCode("");
      setStep("code");
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setError(fields.email ?? (cause instanceof ApiFailure ? cause.error.message : "Could not send the code."));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(value: string) {
    if (!started) return;
    setBusy(true);
    setError("");
    try {
      const me = await apiFetch<Me>("/me/email/verify/", {
        method: "POST",
        body: { verification_id: started.verification_id, code: value },
      });
      setStep("done");
      await onChanged(me);
    } catch (cause) {
      setCode("");
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not work. Try again.");
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      const me = await apiFetch<Me>("/me/email/", { method: "DELETE" });
      await onChanged(me);
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not remove the address.");
    } finally {
      setBusy(false);
    }
  }

  const typed = email.trim().toLowerCase();
  const sameConfirmed = verified && typed === (current ?? "");
  const looksLikeEmail = /^\S+@\S+\.\S+$/.test(typed);

  const footer =
    step === "address" ? (
      <>
        {current ? <SheetGlassButton label="Remove" icon="trash-outline" onPress={() => void remove()} disabled={busy} /> : null}
        <SheetPrimaryButton
          label="Send code"
          icon="mail-outline"
          busy={busy}
          busyLabel="Sending…"
          disabled={!looksLikeEmail || sameConfirmed}
          onPress={() => void send()}
        />
      </>
    ) : step === "code" ? (
      <>
        <SheetGlassButton
          label="Change"
          accessibilityLabel="Change the address"
          icon="create-outline"
          onPress={() => setStep("address")}
          disabled={busy}
        />
        <SheetPrimaryButton
          label="Confirm"
          busy={busy}
          busyLabel="Checking…"
          disabled={code.length < 6}
          onPress={() => void confirm(code)}
        />
      </>
    ) : (
      <SheetPrimaryButton label="Done" onPress={onClose} />
    );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={step === "done" ? "Email confirmed" : current ? "Your email" : "Add an email"}
      closeLabel="Close email"
      footer={footer}
    >
      {step === "address" ? (
        <View style={{ gap: space[3] }}>
          <Type variant="body" style={{ color: theme.color.ink["700"] }}>
            {"For receipts, agreements and getting back into your account. We'll send a six-digit code to confirm it's yours."}
          </Type>
          <SheetCard>
            <View style={styles.sheetField}>
              <Ionicons name="mail-outline" size={20} color={error ? theme.color.laterite["600"] : KOLA} />
              <TextInput
                ref={inputRef}
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  if (error) setError("");
                }}
                placeholder="you@example.com"
                placeholderTextColor={PLACEHOLDER}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
                autoFocus={!current}
                accessibilityLabel="Email address"
                maxFontSizeMultiplier={maxFontSizeMultiplier}
                selectionColor={KOLA}
                cursorColor={KOLA}
                returnKeyType="send"
                onSubmitEditing={() => looksLikeEmail && !sameConfirmed && void send()}
                style={styles.sheetInput}
              />
            </View>
          </SheetCard>
          {current ? (
            <View style={styles.sheetNote}>
              {verified ? <StatusBadge tone="good" label="Confirmed" /> : <StatusBadge tone="waiting" label="Not confirmed yet" />}
              <Type variant="caption" style={{ flex: 1, color: theme.color.ink["500"] }}>
                {verified
                  ? "A new address replaces this one only once its code is confirmed."
                  : "Send a code to this address to confirm it, or type a different one."}
              </Type>
            </View>
          ) : null}
          {error ? <Notice tone="error" title={error} /> : null}
        </View>
      ) : null}

      {step === "code" && started ? (
        <View style={{ gap: space[3] }}>
          <Type variant="body" style={{ color: theme.color.ink["700"] }}>
            {`We sent six digits to ${started.email}. It can take a minute — check spam if it does not arrive.`}
          </Type>
          <CodeCells
            value={code}
            onChangeText={(value) => {
              const digits = value.replace(/\D/g, "").slice(0, 6);
              setCode(digits);
              if (error) setError("");
              if (digits.length === 6 && !busy) void confirm(digits);
            }}
            error={Boolean(error)}
            autoFocus
            inputRef={codeRef}
          />
          <View style={styles.clock}>
            <Type variant="caption" style={{ color: theme.color.ink["500"] }}>
              Expires in 5 minutes
            </Type>
            {resendIn > 0 ? (
              <Type variant="caption" style={{ color: theme.color.ink["300"] }}>
                New code in {resendIn}s
              </Type>
            ) : (
              <Pressable onPress={() => void send()} disabled={busy} accessibilityRole="button" hitSlop={8}>
                <Type variant="captionStrong" style={{ color: KOLA }}>
                  Send a new code
                </Type>
              </Pressable>
            )}
          </View>
          {error ? <Notice tone="error" title={error} /> : null}
        </View>
      ) : null}

      {step === "done" ? (
        <View style={{ alignItems: "center", gap: space[2], paddingVertical: space[2] }}>
          <SuccessMark tone={KOLA} />
          <Type variant="title2" style={{ textAlign: "center" }}>
            {started?.email ?? email}
          </Type>
          <Type variant="caption" style={{ textAlign: "center", color: theme.color.ink["500"] }}>
            Confirmed and on your account.
          </Type>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[1],
  },
  panel: {
    borderRadius: PANEL_RADIUS,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_EDGE,
  },
  // Android draws elevation through a translucent fill as a smudge, so there the
  // edge does it alone.
  panelLift: {
    shadowColor: DEEP,
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 52,
    paddingHorizontal: 14,
  },
  rowTall: {
    alignItems: "flex-start",
  },
  rowLabel: {
    fontSize: 13,
    lineHeight: 18,
  },
  // The row's tint says where you are typing, so the browser's own focus ring is
  // not drawn over it in the web preview.
  input: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    paddingVertical: space[3],
    color: INK,
    outlineWidth: 0,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 999,
  },
  pills: {
    flexDirection: "row",
    gap: space[2],
    marginLeft: "auto",
  },
  pill: {
    minWidth: 52,
    minHeight: 32,
    paddingHorizontal: space[3],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: alpha(DEEP, 0.12),
    backgroundColor: alpha(WHITE, 0.7),
  },
  addPill: {
    flexDirection: "row",
    gap: 4,
    borderColor: alpha(KOLA, 0.35),
    backgroundColor: theme.color.kola["50"],
  },
  pillOn: {
    borderColor: KOLA,
    backgroundColor: KOLA,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: alpha(DEEP, 0.1),
    backgroundColor: alpha(WHITE, 0.7),
    padding: 2,
  },
  stepButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  stepValue: {
    minWidth: 22,
    textAlign: "center",
    color: INK,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 52,
    paddingHorizontal: space[4],
  },
  optionRuled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: ph.line,
  },
  sheetField: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 56,
  },
  sheetInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    paddingVertical: space[3],
    color: INK,
    outlineWidth: 0,
  },
  sheetNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
    paddingHorizontal: space[1],
  },
  clock: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
});
