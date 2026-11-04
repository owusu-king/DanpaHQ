"use client";

import { useCallback, useEffect, useId, useState } from "react";

import { Check, Switch } from "@/components/Check";
import { Notice } from "@/components/Notice";
import { Icon, type IconName } from "@/components/portal/icons";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { ApiFailure } from "@/lib/api";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
  type NotificationPreferencesInput,
} from "@/lib/console";
import { fieldErrorsFrom } from "@/lib/formErrors";

/**
 * Preferences: how Danpa HQ reaches you, and about what.
 *
 * Two cards. **Channels** — the app, texts, email, WhatsApp and push — each with the
 * number it uses where it has one. **Alerts** — the kinds of thing that may
 * interrupt you on those channels. Updates keeps every record whatever is
 * chosen: these govern interruptions, not history.
 *
 * Every switch saves on its own and immediately; a failure puts it back rather
 * than leaving the page claiming something the server did not accept. Numbers
 * save when you press Save or Enter, and the server's objection is shown under
 * the field that caused it.
 */
type BooleanKey = "sms_enabled" | "email_enabled" | "push_enabled" | "sms_important_only" | "whatsapp_enabled";

const ALERT_ICONS: Record<string, IconName> = {
  payments: "payments",
  lease_expiry: "clock",
  leases: "leases",
  requests: "applications",
  viewings: "viewings",
  enquiries: "chat",
  artisans: "hammer",
  account: "users",
};

export default function PreferencesSettingsPage() {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setPreferences(await getNotificationPreferences());
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your preferences.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(key: string, patch: NotificationPreferencesInput, optimistic: Partial<NotificationPreferences>) {
    if (!preferences) return;
    const previous = preferences;
    setPreferences({ ...preferences, ...optimistic });
    setSaving(key);
    setError("");
    try {
      setPreferences(await updateNotificationPreferences(patch));
    } catch (cause) {
      setPreferences(previous);
      setError(cause instanceof ApiFailure ? cause.error.message : "That setting did not save.");
    } finally {
      setSaving(null);
    }
  }

  const set = (key: BooleanKey, value: boolean) => save(key, { [key]: value }, { [key]: value });
  const setAlert = (topic: string, value: boolean) => {
    if (!preferences) return Promise.resolve();
    return save(`alert:${topic}`, { alerts: { [topic]: value } }, { alerts: { ...preferences.alerts, [topic]: value } });
  };

  if (!preferences) {
    return (
      <SettingsCard title="Preferences" className="prefs-card">
        {error ? (
          <div className="prefs-error">
            <Notice tone="error" title={error} />
            <button type="button" className="ws-action" onClick={() => void load()}>Try again</button>
          </div>
        ) : (
          <div className="prefs-skeleton" aria-busy="true" aria-label="Loading preferences">
            {Array.from({ length: 4 }).map((_, index) => <span key={index} className="ws-skeleton-block" />)}
          </div>
        )}
      </SettingsCard>
    );
  }

  const topics = preferences.alert_topics;
  const onCount = topics.filter((topic) => preferences.alerts[topic.key] !== false).length;

  return (
    <>
      {error ? <Notice tone="error" title={error} /> : null}

      <SettingsCard title="Channels" className="prefs-card">
        <ul className="prefs-channels">
          <li className="prefs-channel is-fixed">
            <ChannelHead icon="updates" name="In-app updates" />
            <span className="prefs-always">Always on</span>
          </li>

          <li className={`prefs-channel is-editable${preferences.sms_enabled ? " is-on" : ""}`}>
            <div className="prefs-channel-identity">
              <ChannelHead icon="chat" name="Text messages" detail="Standard network charges apply." />
            </div>
            <div className="prefs-channel-editor">
              <div className="prefs-sms-priority" hidden={!preferences.sms_enabled} title="Viewings, decisions and balances">
                <Check
                  label="Important only"
                  checked={preferences.sms_important_only}
                  disabled={!preferences.sms_enabled || saving === "sms_important_only"}
                  onChange={(value) => void set("sms_important_only", value)}
                />
              </div>
              {preferences.sms_enabled ? (
                <NumberField
                  field="sms_number"
                  label="SMS number"
                  value={preferences.sms_number}
                  fallback={preferences.account_phone}
                  onSave={(value) => updateNotificationPreferences({ sms_number: value })}
                  onSaved={setPreferences}
                />
              ) : null}
            </div>
            <label className="prefs-channel-switch">
              <Switch label="Text messages" checked={preferences.sms_enabled} disabled={saving === "sms_enabled"} onChange={(value) => void set("sms_enabled", value)} />
            </label>
          </li>

          <li className={`prefs-channel is-editable${preferences.whatsapp_enabled ? " is-on" : ""}`}>
            <div className="prefs-channel-identity">
              <ChannelHead
                icon="handset"
                name="WhatsApp"
                badge={preferences.whatsapp_available ? undefined : "Coming soon"}
              />
            </div>
            <div className="prefs-channel-editor">
              {preferences.whatsapp_enabled ? (
                <NumberField
                  field="whatsapp_number"
                  label="WhatsApp number"
                  value={preferences.whatsapp_number}
                  fallback={preferences.account_phone}
                  onSave={(value) => updateNotificationPreferences({ whatsapp_number: value })}
                  onSaved={setPreferences}
                />
              ) : null}
            </div>
            <label className="prefs-channel-switch">
              <Switch label="WhatsApp" checked={preferences.whatsapp_enabled} disabled={saving === "whatsapp_enabled"} onChange={(value) => void set("whatsapp_enabled", value)} />
            </label>
          </li>

          <li className={`prefs-channel${preferences.email_enabled ? " is-on" : ""}`}>
            <label className="prefs-channel-row">
              <ChannelHead
                icon="mail"
                name="Email alerts"
                detail={preferences.account_email_verified && preferences.account_email
                  ? preferences.account_email
                  : "Add and verify an email in your account settings."}
              />
              <Switch
                label="Email alerts"
                checked={preferences.email_enabled}
                disabled={saving === "email_enabled" || ((!preferences.account_email_verified || !preferences.account_email) && !preferences.email_enabled)}
                onChange={(value) => void set("email_enabled", value)}
              />
            </label>
          </li>

          <li className={`prefs-channel${preferences.push_enabled ? " is-on" : ""}`}>
            <label className="prefs-channel-row">
              <ChannelHead icon="device" name="Push notifications" detail="Mobile app" />
              <Switch label="Push notifications" checked={preferences.push_enabled} disabled={saving === "push_enabled"} onChange={(value) => void set("push_enabled", value)} />
            </label>
          </li>
        </ul>
      </SettingsCard>

      <SettingsCard
        title="Alerts"
        className="prefs-card"
        action={<span className="prefs-count"><strong>{onCount}</strong> of {topics.length} on</span>}
      >
        <ul className="prefs-alerts">
          {topics.map((topic) => {
            const on = preferences.alerts[topic.key] !== false;
            return (
              <li key={topic.key}>
                <label className={`prefs-alert${on ? " is-on" : ""}`} title={topic.description}>
                  <span className="prefs-alert-mark" aria-hidden="true"><Icon name={ALERT_ICONS[topic.key] ?? "updates"} /></span>
                  <span className="prefs-alert-text">
                    <strong>{topic.label}</strong>
                  </span>
                  <Switch label={topic.label} checked={on} disabled={saving === `alert:${topic.key}`} onChange={(value) => void setAlert(topic.key, value)} />
                </label>
              </li>
            );
          })}
        </ul>
      </SettingsCard>
    </>
  );
}

function ChannelHead({ icon, name, detail, badge }: { icon: IconName; name: string; detail?: string; badge?: string }) {
  return (
    <span className="prefs-channel-head">
      <span className="prefs-channel-mark" aria-hidden="true"><Icon name={icon} /></span>
      <span className="prefs-channel-text">
        <strong>{name}{badge ? <em>{badge}</em> : null}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
    </span>
  );
}

/** A number that saves on its own: Save or Enter, with the server's word under it. */
function NumberField({
  field,
  label,
  value,
  fallback,
  onSave,
  onSaved,
}: {
  field: "sms_number" | "whatsapp_number";
  label: string;
  value: string;
  fallback: string;
  onSave: (value: string) => Promise<NotificationPreferences>;
  onSaved: (preferences: NotificationPreferences) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const helpId = useId();
  const dirty = draft.trim() !== value;

  async function commit() {
    if (!dirty || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await onSave(draft.trim());
      onSaved(next);
      setDraft(next[field]);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (cause) {
      setError(fieldErrorsFrom(cause)[field] ?? (cause instanceof ApiFailure ? cause.error.message : "That number did not save."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`prefs-number${error ? " has-error" : ""}`}>
      <label>
        <span>{label}</span>
        <span className="prefs-number-field">
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={draft}
            placeholder={fallback}
            aria-invalid={Boolean(error)}
            aria-describedby={error || field === "sms_number" ? helpId : undefined}
            onChange={(event) => { setDraft(event.target.value); setError(""); }}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void commit(); } }}
          />
          {dirty ? (
            <button type="button" className="prefs-number-save" disabled={busy} onClick={() => void commit()}>{busy ? "Saving…" : "Save"}</button>
          ) : saved ? (
            <span className="prefs-number-saved" role="status"><Icon name="check" />Saved</span>
          ) : null}
        </span>
      </label>
      {error || field === "sms_number" ? (
        <small id={helpId} className={!error ? "prefs-number-hint" : undefined} role={error ? "alert" : undefined}>{error || "Blank uses account number."}</small>
      ) : null}
    </div>
  );
}
