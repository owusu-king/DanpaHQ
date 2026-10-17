"use client";

import { FormEvent, useMemo, useState } from "react";

import { Feedback, PageHeader, Panel, ResourceState, useResource } from "@/components/management/ManagementUI";
import { ManagementFailure, managementFetch } from "@/lib/management";

type ConfigurationField = {
  key: string;
  label: string;
  description: string;
  kind: "text" | "choice" | "boolean" | "integer" | "url";
  secret: boolean;
  value: string | number | boolean;
  is_set: boolean;
  source: "management" | "deployment";
  choices: { value: string; label: string }[];
};

type ConfigurationPayload = {
  sections: { name: string; fields: ConfigurationField[] }[];
};

export default function ConfigurationPage() {
  const resource = useResource<ConfigurationPayload>("/configuration/");
  return (
    <>
      <PageHeader
        eyebrow="System operations"
        title="Configuration"
        description="Manage the runtime values the application is designed to change safely. Deployment secrets remain the fallback, and saved secrets are never shown again."
      />
      <ResourceState loading={resource.loading} error={resource.error} />
      {resource.data ? (
        <ConfigurationEditor
          key={JSON.stringify(resource.data)}
          payload={resource.data}
          onSaved={resource.reload}
        />
      ) : null}
    </>
  );
}

function ConfigurationEditor({ payload, onSaved }: { payload: ConfigurationPayload; onSaved: () => Promise<void> }) {
  const fields = useMemo(() => payload.sections.flatMap((section) => section.fields), [payload]);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.key, field.secret ? "" : String(field.value)])));
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ error: "", success: "" });

  function change(key: string, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty((current) => new Set(current).add(key));
    setCleared((current) => { const next = new Set(current); next.delete(key); return next; });
  }

  function revertToDeployment(key: string) {
    setCleared((current) => new Set(current).add(key));
    setDirty((current) => new Set(current).add(key));
    setDraft((current) => ({ ...current, [key]: "" }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const updates: { key: string; clear?: boolean; value?: string | number | boolean }[] = [];
    for (const field of fields) {
      if (!dirty.has(field.key)) continue;
      if (cleared.has(field.key)) { updates.push({ key: field.key, clear: true }); continue; }
      const raw = draft[field.key] ?? "";
      const value = field.kind === "boolean" ? raw === "true" : field.kind === "integer" ? Number(raw) : raw;
      updates.push({ key: field.key, value });
    }
    if (!updates.length) {
      setFeedback({ error: "", success: "Nothing has changed." });
      return;
    }
    setBusy(true);
    setFeedback({ error: "", success: "" });
    try {
      await managementFetch("/configuration/", { method: "PATCH", body: JSON.stringify({ updates }) });
      setFeedback({ error: "", success: "Configuration saved. New operations will use it immediately." });
      await onSaved();
    } catch (cause) {
      setFeedback({ error: cause instanceof ManagementFailure ? cause.message : "Could not save configuration.", success: "" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="management-configuration" onSubmit={save}>
      <Feedback error={feedback.error} success={feedback.success} />
      {payload.sections.map((section) => (
        <Panel key={section.name} title={section.name} meta="Runtime overrides">
          <div className="management-form">
            <div className="management-form-grid">
              {section.fields.map((field) => (
                <label key={field.key}>
                  <span>{field.label}</span>
                  {field.kind === "choice" ? (
                    <select value={draft[field.key]} onChange={(event) => change(field.key, event.target.value)}>
                      {field.choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                    </select>
                  ) : field.kind === "boolean" ? (
                    <select value={draft[field.key]} onChange={(event) => change(field.key, event.target.value)}>
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  ) : (
                    <input
                      type={field.secret ? "password" : field.kind === "integer" ? "number" : field.kind === "url" ? "url" : "text"}
                      value={draft[field.key]}
                      placeholder={field.secret && field.is_set ? "Saved — enter a replacement only" : undefined}
                      autoComplete="off"
                      onChange={(event) => change(field.key, event.target.value)}
                    />
                  )}
                  <small>{field.description}</small>
                  <small>Source: {cleared.has(field.key) ? "deployment after save" : field.source}</small>
                  {field.source === "management" ? (
                    <button className="management-link-button" type="button" onClick={() => revertToDeployment(field.key)}>
                      Use deployment value
                    </button>
                  ) : null}
                </label>
              ))}
            </div>
          </div>
        </Panel>
      ))}
      <div className="management-form-actions management-configuration-save">
        <button className="management-button primary" disabled={busy}>{busy ? "Saving…" : "Save configuration"}</button>
      </div>
    </form>
  );
}
