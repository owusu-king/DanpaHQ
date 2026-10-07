import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Type, space } from "@/components/ui";
import type { SpaceAvailability, SpacePublication, SpaceVerification } from "@/provider";
import { pressableFeedback, surfaceElevation } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

export type StatusTone = "neutral" | "good" | "waiting" | "attention";

const TONE_COLOR: Record<StatusTone, string> = {
  neutral: theme.color.ink["500"],
  good: theme.color.kola["600"],
  waiting: theme.color.harmattan["600"],
  attention: theme.color.laterite["600"],
};

/**
 * `compact` is for a tile rather than a row: a step smaller, and the dot pinned
 * to the first line so a label that wraps stays aligned to it.
 *
 * The label is allowed to wrap rather than truncate. A status cut to
 * "Verification in pro…" is worse than a status on two lines, and tiles in a
 * row stretch to the tallest anyway.
 */
export function StatusLine({
  label,
  tone = "neutral",
  compact = false,
}: {
  label: string;
  tone?: StatusTone;
  compact?: boolean;
}) {
  const color = TONE_COLOR[tone];
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        alignItems: compact ? "flex-start" : "center",
        gap: space[2],
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: color,
          marginTop: compact ? 5 : 0,
        }}
      />
      <Type
        variant="caption"
        numberOfLines={compact ? 2 : undefined}
        style={{
          color,
          fontWeight: "500",
          flexShrink: 1,
          ...(compact ? { fontSize: 13, lineHeight: 18 } : null),
        }}
      >
        {label}
      </Type>
    </View>
  );
}

export function propertyStatus(verification: {
  state: string;
  review_state: string;
  review_state_label: string;
}): { label: string; tone: StatusTone } {
  if (verification.review_state === "verified") return { label: "Verified", tone: "good" };
  if (verification.review_state === "pending_verification") return { label: "Verification in progress", tone: "waiting" };
  if (["changes_required", "rejected", "suspended", "expired"].includes(verification.review_state)) {
    return { label: verification.review_state_label, tone: "attention" };
  }
  if (verification.review_state === "withdrawn") return { label: "Verification withdrawn", tone: "waiting" };
  return { label: verification.state === "draft" ? "Setup incomplete" : "Not submitted", tone: "neutral" };
}

export function spaceStatus({
  verification,
  publication,
  availability,
}: {
  verification: SpaceVerification;
  publication: SpacePublication;
  availability: SpaceAvailability;
}): { label: string; tone: StatusTone } {
  if (availability.state === "occupied") return { label: "Occupied", tone: "neutral" };
  if (["changes_requested", "rejected", "suspended", "expired"].includes(verification.state)) {
    return { label: verification.state_label, tone: "attention" };
  }
  if (verification.state === "submitted" || verification.state === "under_review") {
    return { label: "Verification in progress", tone: "waiting" };
  }
  if (verification.state !== "verified") return { label: verification.state_label, tone: "neutral" };
  return {
    label: publication.state === "published" ? "Verified · Public · Available" : "Verified · Available",
    tone: "good",
  };
}

export function EntityHeader({
  eyebrow,
  title,
  subtitle,
  status,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  status?: ReactNode;
}) {
  // A white card on the record's green, as the dashboards' are (owner,
  // 2026-10-06). It was an all-caps eyebrow repeating the title bar, the
  // name, and a beige rule under it — the template look the redesign replaced.
  return (
    <View style={styles.entity}>
      {eyebrow ? <Type variant="caption" style={styles.entityEyebrow}>{eyebrow}</Type> : null}
      <Type variant="title1" style={styles.entityTitle}>{title}</Type>
      {subtitle ? <Type variant="caption" style={styles.entitySubtitle}>{subtitle}</Type> : null}
      {status ? <View style={{ marginTop: space[1] }}>{status}</View> : null}
    </View>
  );
}

export function Disclosure({
  title,
  children,
  initiallyOpen = false,
}: {
  title: string;
  children: ReactNode;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: theme.color.field["200"] }}>
      <Pressable
        accessibilityRole="button"
        aria-expanded={open}
        onPress={() => setOpen((value) => !value)}
        {...pressableFeedback(theme.color.field["200"])}
        style={{ minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] }}
      >
        <Type variant="bodyStrong" style={{ flex: 1 }}>{title}</Type>
        <Ionicons name={open ? "remove" : "add"} size={20} color={theme.color.ink["500"]} />
      </Pressable>
      {open ? <View style={{ paddingBottom: space[5], gap: space[3] }}>{children}</View> : null}
    </View>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: rows }).map((_, index) => (
        <View key={index} style={{ paddingVertical: space[4], gap: space[2], borderTopWidth: 1, borderTopColor: theme.color.field["200"] }}>
          <View style={{ width: "42%", height: 14, borderRadius: 4, backgroundColor: theme.color.field["200"] }} />
          <View style={{ width: "68%", height: 10, borderRadius: 4, backgroundColor: theme.color.field["100"] }} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  entity: {
    gap: space[1],
    padding: space[4],
    borderRadius: 20,
    borderWidth: 1,
    borderColor: alpha(theme.color.kola["900"], 0.09),
    backgroundColor: theme.color.field["0"],
    ...surfaceElevation,
  },
  entityEyebrow: {
    color: theme.color.ink["500"],
  },
  entityTitle: {
    fontSize: 24,
    lineHeight: 30,
    color: theme.color.ink["900"],
  },
  entitySubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.color.ink["500"],
  },
});
