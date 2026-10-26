/**
 * The frame a creation flow walks in on a phone: a strip of steps, the step,
 * one pinned footer.
 *
 * The twin of the web `WizardShell` (owner, 2026-10-20: creation in a modal,
 * like agreement creation; simple, concise, powerful). A rail beside the step
 * has no room on a phone, so the steps are a strip of glyphs across the top.
 * Every step keeps its own glyph, and a finished one turns kola green behind it
 * rather than swapping the glyph for a tick — six identical ticks say nothing
 * about which step is which.
 *
 * Steps decide nothing here. Each flow says which steps it has, which are done
 * and which may be opened; this draws that and reports where somebody pressed.
 */

import Ionicons from "@expo/vector-icons/Ionicons";
import { Fragment, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ActionBar, EDGE, INK, KOLA, KOLA_DEEP, LATERITE, MUTED, PAPER, PRESSED } from "@/components/record/RecordSurfaces";
import { Type, space } from "@/components/ui";
import type { Glyph } from "@/creationGlyphs";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

export type WizardStep = {
  key: string;
  label: string;
  /** One line under the step's title. */
  hint: string;
  icon: Glyph;
  done: boolean;
  /** Whether pressing it on the strip opens it. */
  reachable: boolean;
};

export function WizardFrame({
  steps,
  current,
  onGo,
  footer,
  children,
}: {
  steps: WizardStep[];
  current: string;
  onGo: (key: string) => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const at = Math.max(0, steps.findIndex((step) => step.key === current));
  const step = steps[at] ?? steps[0]!;

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <View style={styles.strip} accessibilityRole="tablist">
          {steps.map((item, index) => {
            const state = item.key === step.key ? "current" : item.done ? "done" : "todo";
            return (
              <Fragment key={item.key}>
                {index ? (
                  <View style={[styles.link, steps[index - 1]!.done || state !== "todo" ? styles.linkOn : null]} />
                ) : null}
                <Pressable
                  accessibilityRole="tab"
                  accessibilityLabel={`${item.label}${item.done ? ", done" : ""}`}
                  aria-selected={state === "current"}
                  aria-disabled={!item.reachable}
                  disabled={!item.reachable}
                  hitSlop={6}
                  onPress={() => onGo(item.key)}
                  style={({ pressed }) => [
                    styles.mark,
                    state === "done" ? styles.markDone : state === "current" ? styles.markNow : null,
                    pressed ? { opacity: 0.75 } : null,
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={17}
                    color={state === "done" ? PAPER : state === "current" ? KOLA_DEEP : MUTED}
                  />
                </Pressable>
              </Fragment>
            );
          })}
        </View>
        <View style={styles.head}>
          <Type variant="label" style={styles.count}>{`STEP ${at + 1} OF ${steps.length}`}</Type>
          <Type variant="title2" accessibilityRole="header" style={styles.title}>{step.label}</Type>
          <Type variant="caption" style={styles.hint}>{step.hint}</Type>
        </View>
      </View>

      <ScrollView
        key={step.key}
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>

      <ActionBar>{footer}</ActionBar>
    </View>
  );
}

/**
 * Pick one, drawn: tiles with a glyph, a name and a short line.
 *
 * The property's water, power and compound, the kind of property and the kind
 * of Unit — choices of three to six where a sheet hid the options.
 */
export function ChoiceTiles({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; hint?: string; icon: Glyph }[];
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.choices}>
      <Type variant="captionStrong" style={styles.choicesLabel}>{label}</Type>
      <View style={styles.choiceGrid} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((option) => {
          const on = value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              aria-checked={on}
              accessibilityLabel={option.hint ? `${option.label}. ${option.hint}` : option.label}
              onPress={() => onChange(option.value)}
              {...pressableFeedback(PRESSED)}
              style={({ pressed }) => [styles.choice, on ? styles.choiceOn : null, pressed ? { opacity: 0.85 } : null]}
            >
              <View style={[styles.choiceMark, on ? styles.choiceMarkOn : null]}>
                <Ionicons name={option.icon} size={18} color={on ? PAPER : theme.color.ink["700"]} />
              </View>
              <View style={styles.choiceCopy}>
                <Type variant="captionStrong" numberOfLines={2} style={styles.choiceName}>{option.label}</Type>
                {option.hint ? (
                  <Type variant="caption" numberOfLines={2} style={[styles.choiceHint, on ? { color: KOLA_DEEP } : null]}>
                    {option.hint}
                  </Type>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A review: one line per thing, its glyph, what was said, and the way back. */
export function ReviewList({ children }: { children: ReactNode }) {
  return <View style={styles.review}>{children}</View>;
}

export function ReviewLine({
  icon,
  term,
  value,
  todo = false,
  first = false,
  onEdit,
}: {
  icon: Glyph;
  term: string;
  value: string;
  /** Still owed: the line says so in colour, not in another list. */
  todo?: boolean;
  first?: boolean;
  onEdit?: () => void;
}) {
  return (
    <View style={[styles.line, first ? null : styles.lineRuled]}>
      <View style={[styles.lineMark, todo ? styles.lineMarkTodo : null]}>
        <Ionicons name={icon} size={16} color={todo ? LATERITE : KOLA_DEEP} />
      </View>
      <View style={styles.lineCopy}>
        <Type variant="captionStrong" numberOfLines={1} style={styles.lineTerm}>{term}</Type>
        <Type variant="caption" style={[styles.lineValue, todo ? styles.lineValueTodo : null]}>{value}</Type>
      </View>
      {onEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Change ${term.toLowerCase()}`}
          hitSlop={8}
          onPress={onEdit}
          style={({ pressed }) => [styles.lineEdit, pressed ? { backgroundColor: theme.color.kola["50"] } : null]}
        >
          <Type variant="captionStrong" style={{ color: KOLA }}>Change</Type>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.field["50"] },
  top: {
    gap: space[4],
    paddingHorizontal: space[4],
    paddingTop: space[3],
    paddingBottom: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: EDGE,
    backgroundColor: PAPER,
  },
  strip: { flexDirection: "row", alignItems: "center" },
  link: { flex: 1, height: 2, marginHorizontal: 4, borderRadius: 1, backgroundColor: theme.color.field["200"] },
  linkOn: { backgroundColor: theme.color.kola["300"] },
  mark: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.color.field["200"],
    backgroundColor: PAPER,
  },
  markDone: { borderColor: KOLA, backgroundColor: KOLA },
  markNow: { borderWidth: 2, borderColor: KOLA, backgroundColor: theme.color.kola["50"] },
  head: { gap: 2 },
  count: { color: KOLA, letterSpacing: 0.8 },
  title: { color: INK },
  hint: { color: MUTED },
  body: { flex: 1 },
  bodyContent: { padding: space[4], paddingBottom: space[8], gap: space[5] },

  choices: { gap: space[2] },
  choicesLabel: { color: theme.color.ink["700"] },
  choiceGrid: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  choice: {
    width: "48.5%",
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[3],
    borderRadius: 14,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: PAPER,
  },
  choiceOn: { borderWidth: 1.5, borderColor: KOLA, backgroundColor: theme.color.kola["50"] },
  choiceMark: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.field["100"],
  },
  choiceMarkOn: { backgroundColor: KOLA },
  choiceCopy: { flex: 1, minWidth: 0, gap: 1 },
  choiceName: { color: INK },
  choiceHint: { fontSize: 12, lineHeight: 16, color: MUTED },

  review: {
    overflow: "hidden",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: PAPER,
  },
  line: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[3], paddingHorizontal: space[3] },
  lineRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: EDGE },
  lineMark: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.kola["50"],
  },
  lineMarkTodo: { backgroundColor: theme.color.laterite["100"] },
  lineCopy: { flex: 1, minWidth: 0, gap: 1 },
  lineTerm: { color: INK },
  lineValue: { color: theme.color.ink["700"] },
  lineValueTodo: { color: LATERITE, fontWeight: "500" },
  lineEdit: { paddingHorizontal: space[2], paddingVertical: space[1], borderRadius: 8 },
});
