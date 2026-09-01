"use client";

import { useCallback, useEffect, useState } from "react";

import { Notice } from "@/components/Notice";
import { LoadingRows } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/console";
import { Switch } from "@/components/Check";

/**
 * What Rooomly may send, and how.
 *
 * These three preferences have existed in the backend the whole time and no
 * client ever exposed them, so an SMS that costs the user money could not be
 * turned off from either app.
 *
 * Each switch saves on its own: they are independent, isolated, and safe to
 * apply immediately. A failure puts the switch back rather than leaving the
 * interface claiming something the server did not accept.
 */
export default function NotificationSettingsPage() {
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
    <section className="settings-section">
      <h2>How Rooomly reaches you</h2>
      <p className="type-caption">
        Decisions always appear in Updates. These control what else is sent.
      </p>

      {error ? <Notice tone="error" title={error} /> : null}
      {!preferences && !error ? <LoadingRows rows={3} /> : null}

      {preferences ? (
        <div>
          <Toggle
            label="Text messages"
            detail="Standard network charges apply."
            checked={preferences.sms_enabled}
            busy={saving === "sms_enabled"}
            onChange={(value) => void set("sms_enabled", value)}
          />
          <Toggle
            label="Only important texts"
            detail="Confirmed viewings and decisions only."
            checked={preferences.sms_important_only}
            busy={saving === "sms_important_only"}
            disabled={!preferences.sms_enabled}
            onChange={(value) => void set("sms_important_only", value)}
          />
          <Toggle
            label="Push notifications"
            checked={preferences.push_enabled}
            busy={saving === "push_enabled"}
            onChange={(value) => void set("push_enabled", value)}
          />
        </div>
      ) : null}
    </section>
  );
}

function Toggle({
  label,
  detail,
  checked,
  busy,
  disabled = false,
  onChange,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  busy: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="settings-toggle">
      <span className="settings-row-text">
        <span className="type-body-strong">{label}</span>
        {detail ? <span>{detail}</span> : null}
      </span>
      <Switch
        label={label}
        checked={checked}
        disabled={disabled || busy}
        onChange={onChange}
      />
    </label>
  );
}
