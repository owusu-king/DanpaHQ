import { useCallback, useEffect, useState } from "react";
import { ScrollView, Switch, View } from "react-native";

import { ApiFailure } from "@/api";
import { Notice, Type, space } from "@/components/ui";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
} from "@/notifications";
import { theme } from "@/theme";

/**
 * What Rooomly may send, and how.
 *
 * These three preferences have existed in the backend the whole time and no
 * client exposed them, so an SMS that costs the user money could not be turned
 * off from either app. Each switch saves on its own — they are independent and
 * safe to apply immediately — and a failure puts the switch back rather than
 * leaving the screen claiming something the server did not accept.
 */
export default function NotificationSettingsScreen() {
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
    <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Type variant="label">SETTINGS</Type>
        <Type variant="display2" accessibilityRole="header">Notifications</Type>
        <Type variant="body">
          Decisions always appear in Updates. These control what else is sent.
        </Type>
      </View>

      {error ? <Notice tone="error" title={error} /> : null}
      {!preferences && !error ? <Type variant="caption">Loading…</Type> : null}

      {preferences ? (
        <View>
          <Toggle
            label="Text messages"
            detail="Standard network charges apply."
            value={preferences.sms_enabled}
            busy={saving === "sms_enabled"}
            onChange={(value) => void set("sms_enabled", value)}
          />
          <Toggle
            label="Only important texts"
            detail="Confirmed viewings and decisions only."
            value={preferences.sms_important_only}
            busy={saving === "sms_important_only"}
            disabled={!preferences.sms_enabled}
            onChange={(value) => void set("sms_important_only", value)}
          />
          <Toggle
            label="Push notifications"
            value={preferences.push_enabled}
            busy={saving === "push_enabled"}
            onChange={(value) => void set("push_enabled", value)}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

function Toggle({
  label,
  detail,
  value,
  busy,
  disabled = false,
  onChange,
}: {
  label: string;
  detail?: string;
  value: boolean;
  busy: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View
      style={{
        minHeight: 72,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: space[3],
        paddingVertical: space[3],
        borderBottomWidth: 1,
        borderBottomColor: theme.color.field["200"],
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <View style={{ flex: 1, minWidth: 180, gap: space[1] }}>
        <Type variant="bodyStrong">{label}</Type>
        {detail ? <Type variant="caption">{detail}</Type> : null}
      </View>
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
