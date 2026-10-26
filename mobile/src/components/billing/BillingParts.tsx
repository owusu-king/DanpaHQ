import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { View, type DimensionValue } from "react-native";

import { grouped, type Meter, type Tone } from "@/billingPresentation";
import { Surface, Type, radius, space } from "@/components/ui";
import { theme } from "@/theme";

/**
 * The small parts Plan & billing is built from on a phone.
 *
 * Tone is spent the way the web spends it: positive for an active plan, neutral
 * for ending, changing and ended, info for a payment in flight, warning for a
 * renewal that is due or a meter near its limit, critical only for past due and
 * a meter above its limit. Status is always a word; colour only reinforces it.
 */
export const TONES: Record<Tone, { fg: string; bg: string; rule: string }> = {
  positive: { fg: theme.color.kola["800"], bg: theme.color.kola["50"], rule: theme.color.kola["600"] },
  neutral: { fg: theme.color.ink["700"], bg: theme.color.field["100"], rule: theme.color.ink["500"] },
  info: { fg: theme.color.lagoon["600"], bg: theme.color.lagoon["100"], rule: theme.color.lagoon["600"] },
  warning: { fg: theme.color.harmattan["600"], bg: theme.color.harmattan["100"], rule: theme.color.harmattan["500"] },
  critical: { fg: theme.color.laterite["600"], bg: theme.color.laterite["100"], rule: theme.color.laterite["600"] },
};

export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  const palette = TONES[tone];
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 6,
        paddingHorizontal: space[2] + 2,
        paddingVertical: 2,
        borderRadius: radius.pill,
        backgroundColor: palette.bg,
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.rule }} />
      <Type variant="captionStrong" style={{ color: palette.fg, fontSize: 13, lineHeight: 18 }}>
        {label}
      </Type>
    </View>
  );
}

/** A section heading on a phone: a sentence, not a shouted eyebrow. */
export function SectionTitle({ children }: { children: string }) {
  return (
    <Type variant="title2" accessibilityRole="header">
      {children}
    </Type>
  );
}

/** One fact about the subscription — what it is, then its value, and at most one action beside it. */
export function FactRow({ label, value, action }: { label: string; value: string; action?: ReactNode }) {
  return (
    <View style={{ gap: 2, paddingVertical: space[3], borderTopWidth: 1, borderTopColor: theme.color.field["200"] }}>
      <Type variant="caption">{label}</Type>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space[3], rowGap: space[1] }}>
        <Type variant="bodyStrong" style={{ flexShrink: 1 }}>
          {value}
        </Type>
        {action}
      </View>
    </View>
  );
}

/**
 * A limit and how much of it is in use. The count is the fact; the bar only
 * reinforces it, so the row is read out as one sentence and the bar not at all.
 */
export function UsageMeter({ meter }: { meter: Meter }) {
  const strained = meter.state === "full" || meter.state === "near";
  const fill =
    meter.state === "over"
      ? theme.color.laterite["600"]
      : strained
        ? theme.color.harmattan["500"]
        : theme.color.kola["600"];
  const noteColor =
    meter.state === "over"
      ? theme.color.laterite["600"]
      : strained
        ? theme.color.harmattan["600"]
        : theme.color.ink["500"];
  return (
    <View accessible accessibilityLabel={`${meter.name}: ${meter.valueText}. ${meter.note}.`} style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space[3] }}>
        <Type variant="body" style={{ flexShrink: 1 }}>
          {meter.name}
        </Type>
        <Type variant="bodyStrong" style={{ fontVariant: ["tabular-nums"] }}>
          {grouped(meter.used)}
          {meter.limit === null ? null : (
            <Type variant="body" style={{ color: theme.color.ink["500"] }}>{` / ${grouped(meter.limit)}`}</Type>
          )}
        </Type>
      </View>
      <View style={{ height: 6, overflow: "hidden", borderRadius: radius.pill, backgroundColor: theme.color.field["200"] }}>
        <View style={{ width: `${Math.round(meter.fill * 100)}%`, height: "100%", borderRadius: radius.pill, backgroundColor: fill }} />
      </View>
      <Type variant="caption" style={{ color: noteColor }}>
        {meter.note}
      </Type>
    </View>
  );
}

/** Something that needs a person — a renewal due, a payment pending, a change about to happen. */
export function Attention({
  tone,
  title,
  body,
  children,
}: {
  tone: Tone;
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  const palette = TONES[tone];
  return (
    <View
      style={{
        gap: space[3],
        padding: space[4],
        borderRadius: 2,
        borderLeftWidth: 3,
        borderLeftColor: palette.rule,
        backgroundColor: palette.bg,
      }}
    >
      <View accessible accessibilityRole={tone === "critical" ? "alert" : "summary"} style={{ gap: space[1] }}>
        <Type variant="bodyStrong">{title}</Type>
        {body ? (
          <Type variant="caption" style={{ color: theme.color.ink["700"] }}>
            {body}
          </Type>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** The mark at the top of a result: a tick for something that happened, a cross for something that did not. */
export function ResultMark({ tone, icon }: { tone: Tone; icon: "checkmark" | "close" }) {
  const palette = TONES[tone];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: palette.bg,
      }}
    >
      <Ionicons name={icon} size={30} color={palette.rule} />
    </View>
  );
}

/** A placeholder shaped like the text that will replace it, so nothing jumps when it arrives. */
export function Bone({ width = "100%", height = 14, round = 6 }: { width?: DimensionValue; height?: number; round?: number }) {
  return <View style={{ width, height, borderRadius: round, backgroundColor: theme.color.field["200"] }} />;
}

export function BillingSkeleton() {
  return (
    <View accessible accessibilityLabel="Loading your plan" accessibilityRole="progressbar" style={{ gap: space[6] }}>
      <Surface style={{ padding: space[5], gap: space[3] }}>
        <Bone width="28%" height={12} />
        <Bone width="42%" height={36} />
        <Bone width="88%" />
        <Bone width="36%" height={30} />
        <Bone width="52%" />
        <Bone height={48} round={8} />
      </Surface>
      <View style={{ gap: space[3] }}>
        <Bone width="36%" height={22} />
        <Bone height={56} />
        <Bone height={56} />
      </View>
    </View>
  );
}
