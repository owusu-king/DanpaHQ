"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  Feedback,
  PageHeader,
  Panel,
  ResourceState,
  Status,
  TabPanel,
  Tabs,
  managementError,
  useNotice,
  useQueryState,
  useResource,
} from "@/components/management/ManagementUI";
import { managementFetch, useManagement } from "@/lib/management";
import { MFAConfiguration } from "@/components/management/MFAConfiguration";

type ConfigurationField = {
  key: string;
  label: string;
  description: string;
  kind: "text" | "choice" | "boolean" | "integer" | "url" | "multiline";
  secret: boolean;
  value: string | number | boolean;
  is_set: boolean;
  source: "management" | "deployment";
  choices: { value: string; label: string }[];
};

type ConfigurationPayload = {
  sections: { name: string; fields: ConfigurationField[] }[];
};

function sectionId(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Configuration, one section at a time.
 *
 * The sections are views of one form: switching between them keeps every
 * unsaved value, a mark on a tab says which sections hold changes, and one save
 * sends them all. The chosen section is kept in the address, so a link can
 * open Two-factor authentication or Payments directly.
 */
export default function ConfigurationPage() {
  const { can } = useManagement();
  const resource = useResource<ConfigurationPayload>("/configuration/");
  const [stored, setSection] = useQueryState("section");
  const [dirtySections, setDirtySections] = useState<Set<string>>(new Set());
  const sections = resource.data?.sections ?? [];
  const mayManage = can("manage_configuration");
  const tabs = [
    ...(mayManage ? [{ id: "mfa", label: "Two-factor authentication" }] : []),
    ...sections.map((section) => ({ id: sectionId(section.name), label: section.name, marked: dirtySections.has(sectionId(section.name)) })),
  ];
  const active = tabs.some((tab) => tab.id === stored) ? stored : tabs[0]?.id ?? "";

  return (
    <>
      <PageHeader
        title="Configuration"
      />
      {tabs.length ? <Tabs label="Configuration sections" tabs={tabs} active={active} onChange={setSection} /> : null}
      <div className="management-configuration">
        {mayManage ? (
          <TabPanel id="mfa" active={active}>
            <MFAConfiguration />
          </TabPanel>
        ) : null}
        {resource.loading || resource.error ? (
          <Panel><ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} /></Panel>
        ) : null}
        {resource.data ? (
          <ConfigurationEditor
            key={JSON.stringify(resource.data)}
            payload={resource.data}
            active={active}
            readOnly={!mayManage}
            onDirtySections={setDirtySections}
            onSaved={resource.reload}
          />
        ) : null}
      </div>
    </>
  );
}

function ConfigurationEditor({
  payload,
  active,
  readOnly,
  onDirtySections,
  onSaved,
}: {
  payload: ConfigurationPayload;
  active: string;
  readOnly: boolean;
  onDirtySections: (sections: Set<string>) => void;
  onSaved: () => Promise<void>;
}) {
  const notify = useNotice();
  const fields = useMemo(() => payload.sections.flatMap((section) => section.fields), [payload]);
  const initial = useMemo(() => Object.fromEntries(fields.map((field) => [field.key, field.secret ? "" : String(field.value)])), [fields]);
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    onDirtySections(new Set(payload.sections
      .filter((section) => section.fields.some((field) => dirty.has(field.key)))
      .map((section) => sectionId(section.name))));
  }, [dirty, onDirtySections, payload]);

  function change(key: string, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty((current) => {
      const next = new Set(current);
      // Typing a value back to what it was is not a change.
      if (value === initial[key] && !cleared.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setCleared((current) => { const next = new Set(current); next.delete(key); return next; });
  }

  function revertToDeployment(key: string) {
    setCleared((current) => new Set(current).add(key));
    setDirty((current) => new Set(current).add(key));
    setDraft((current) => ({ ...current, [key]: "" }));
  }

  function discard() {
    setDraft(initial);
    setDirty(new Set());
    setCleared(new Set());
    setError("");
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
    if (!updates.length) return;
    setBusy(true);
    setError("");
    try {
      await managementFetch("/configuration/", { method: "PATCH", body: JSON.stringify({ updates }) });
      notify("success", "Configuration saved. New operations use it immediately.");
      await onSaved();
    } catch (cause) {
      setError(managementError(cause, "Could not save configuration."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="management-configuration" onSubmit={save}>
      {payload.sections.map((section) => (
        <TabPanel key={section.name} id={sectionId(section.name)} active={active}>
          <Panel>
            <div className="management-form">
              <div className="management-form-grid">
                {section.fields.map((field) => {
                  const id = `setting-${field.key}`;
                  const source = cleared.has(field.key) ? "deployment" : field.source;
                  return (
                    <div key={field.key} className={`management-field management-setting${dirty.has(field.key) ? " is-dirty" : ""}`}>
                      <label htmlFor={id}>{field.label}</label>
                      {field.kind === "choice" ? (
                        <select id={id} value={draft[field.key]} disabled={readOnly || busy} onChange={(event) => change(field.key, event.target.value)}>
                          {field.choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                        </select>
                      ) : field.kind === "multiline" ? (
                        <textarea id={id} rows={12} value={draft[field.key]} disabled={readOnly || busy} onChange={(event) => change(field.key, event.target.value)} />
                      ) : field.kind === "boolean" ? (
                        <select id={id} value={draft[field.key]} disabled={readOnly || busy} onChange={(event) => change(field.key, event.target.value)}>
                          <option value="true">Enabled</option>
                          <option value="false">Disabled</option>
                        </select>
                      ) : (
                        <input
                          id={id}
                          type={field.secret ? "password" : field.kind === "integer" ? "number" : field.kind === "url" ? "url" : "text"}
                          value={draft[field.key]}
                          placeholder={field.secret && field.is_set ? "Saved — enter a replacement only" : undefined}
                          autoComplete="off"
                          disabled={readOnly || busy}
                          onChange={(event) => change(field.key, event.target.value)}
                        />
                      )}
                      <small>{field.description}</small>
                      <div className="management-setting-meta">
                        <Status
                          value={source}
                          tone={source === "management" ? "info" : "neutral"}
                          label={cleared.has(field.key) ? "Deployment value after saving" : source === "management" ? "Set here" : "Deployment value"}
                        />
                        {field.source === "management" && !cleared.has(field.key) && !readOnly ? (
                          <button className="management-link-button" type="button" onClick={() => revertToDeployment(field.key)}>
                            Use deployment value
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Panel>
        </TabPanel>
      ))}
      <Feedback error={error} />
      {dirty.size ? (
        <div className="management-configuration-save" role="region" aria-label="Unsaved changes">
          <span>{dirty.size} unsaved {dirty.size === 1 ? "change" : "changes"}</span>
          <button type="button" className="management-button" disabled={busy} onClick={discard}>Discard</button>
          <button type="submit" className="management-button primary" disabled={busy}>{busy ? "Saving…" : "Save configuration"}</button>
        </div>
      ) : null}
    </form>
  );
}
