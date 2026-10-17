import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Switch, View } from "react-native";

import { ApiFailure } from "@/api";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Panel } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  Footnote,
  GroupLabel,
  INK,
  KOLA,
  RULE,
  rowStyles,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { Notice, Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
} from "@/notifications";
import { theme } from "@/theme";

/**
 * What Danpa HQ may send, and how.
 *
 * These three preferences have existed in the backend the whole time and no
 * client exposed them, so an SMS that costs the user money could not be turned
 * off from either app. Each switch saves on its own — they are independent and
 * safe to apply immediately — and a failure puts the switch back rather than
 * leaving the screen claiming something the server did not accept.
 *
 * Refined on review (2026-09-15): one glass panel instead of a page of rules, with
 * "Only important texts" nested under the switch it depends on, so the two read as
 * one decision. The line about Updates is a footnote, not a paragraph.
 */
export default function NotificationSettingsScreen() {
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [saving, setSaving] = useState<keyof NotificationPreferences | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setPreferences(await getNotificationPreferences());
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your notification settings.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function set(key: keyof NotificationPreferences, value: boolean) {
    if (!preferences) return;
    const previous = preferences;
    setPreferences({ ...preferences, [key]: value });
    setSaving(key);
    setError("");
    try {
      setPreferences(await updateNotificationPreferences({ [key]: value }));
    } catch (cause) {
      setPreferences(previous);
      setError(cause instanceof ApiFailure ? cause.error.message : "That setting did not save.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <IndexGround>
      <ScrollView contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom, gap: density.sectionGap + space[2] }}>
        {error ? <Notice tone="error" title={error} /> : null}
        {!preferences && !error ? <PreferencesSkeleton /> : null}

        {preferences ? (
          <View style={styles.section}>
            <GroupLabel>What Danpa HQ may send</GroupLabel>
            <Panel>
              <Toggle
                icon="chatbubble-ellipses-outline"
                label="Text messages"
                detail="Standard network charges apply."
                value={preferences.sms_enabled}
                busy={saving === "sms_enabled"}
                onChange={(value) => void set("sms_enabled", value)}
              />
              <Toggle
                nested
                icon="star-outline"
                label="Only important texts"
                detail="Confirmed viewings and decisions only."
                value={preferences.sms_important_only}
                busy={saving === "sms_important_only"}
                disabled={!preferences.sms_enabled}
                onChange={(value) => void set("sms_important_only", value)}
              />
              <Toggle
                icon="notifications-outline"
                label="Push notifications"
                detail="Free, and the quickest way to hear."
                value={preferences.push_enabled}
                busy={saving === "push_enabled"}
                onChange={(value) => void set("push_enabled", value)}
              />
            </Panel>
            <Footnote>Decisions always appear in Updates. These control what else is sent.</Footnote>
          </View>
        ) : null}
      </ScrollView>
    </IndexGround>
  );
}

/**
 * One setting: what it is, what it costs or gives, and the platform's own switch.
 *
 * The nested one is drawn under the switch it depends on and dims with it, because
 * "only important texts" is a narrowing of texts rather than a setting of its own.
 */
function Toggle({
  icon,
  label,
  detail,
  value,
  busy,
  nested = false,
  disabled = false,
  onChange,
}: {
  icon: IconName;
  label: string;
  detail?: string;
  value: boolean;
  busy: boolean;
  nested?: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={[styles.row, nested ? styles.nested : null, disabled ? styles.dim : null]}>
      {nested ? <View style={styles.rail} /> : (
        <View style={[rowStyles.well, styles.well]}>
          <Ionicons name={icon} size={16} color={KOLA} />
        </View>
      )}
      <View style={rowStyles.rowBody}>
        <Type variant="bodyStrong" style={styles.label}>{label}</Type>
        {detail ? <Type variant="caption" numberOfLines={2} style={rowStyles.rowSub}>{detail}</Type> : null}
      </View>
      {busy ? <ActivityIndicator size="small" color={KOLA} /> : null}
      <Switch
        value={value}
        disabled={disabled || busy}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: theme.color.kola["600"], false: theme.color.field["300"] }}
      />
    </View>
  );
}

/** Shaped like the panel it becomes, so nothing jumps when the settings arrive. */
function PreferencesSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your notification settings" style={styles.section}>
      <Bone width="46%" height={11} />
      <Panel>
        {[0, 1, 2].map((key) => (
          <View key={key} style={[styles.row, key ? styles.ruled : null]}>
            <Bone width={32} height={32} round={10} />
            <View style={rowStyles.rowBody}>
              <Bone width="52%" height={14} />
              <Bone width="72%" />
            </View>
            <Bone width={44} height={26} round={13} />
          </View>
        ))}
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: space[2],
  },
  row: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  // A narrowing of the switch above it, drawn under that switch's own rail.
  nested: {
    paddingLeft: 26,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  rail: {
    width: 20,
    height: 20,
    marginLeft: 6,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: RULE,
    borderBottomLeftRadius: 8,
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  dim: {
    opacity: 0.6,
  },
  well: {
    backgroundColor: theme.color.kola["50"],
  },
  label: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
});
