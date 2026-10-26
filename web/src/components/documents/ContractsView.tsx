"use client";

/**
 * Contracts: what a Portfolio's agreements are made of.
 *
 * Two layers, kept visibly apart because they are apart in law and in the
 * code. Danpa HQ's agreement is controlled wording — a manager reads its
 * clauses here and fills its facts when preparing an agreement, but never
 * edits it. The Portfolio's own **terms templates** are what a manager does
 * write: reusable additional terms, typed here or imported from Word, with
 * the same `${placeholders}` the standard clauses use. They are offered in the
 * agreement builder's Additional terms step and land in the agreement as
 * clearly labelled custom terms.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Check } from "@/components/Check";
import { Icon } from "@/components/portal/icons";
import { useToast } from "@/components/toast/Toaster";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { PanelSearch, PanelSkeleton, PanelState } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import {
  createTermsTemplate,
  deleteTermsTemplate,
  getPortfolioContracts,
  updateTermsTemplate,
  type AgreementPlaceholder,
  type PortfolioContracts,
  type TermsTemplate,
} from "@/lib/console";
import { DocxError, readDocxText } from "@/lib/docx";

const BODY_LIMIT = 6000;
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function ContractsView({
  organizationId,
  creating,
  onCreatingChange,
}: {
  organizationId: string | null;
  /** The head's "New template" asks for the editor through the page. */
  creating: boolean;
  onCreatingChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<PortfolioContracts | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<TermsTemplate | null>(null);
  const [reading, setReading] = useState(false);
  const [removing, setRemoving] = useState<TermsTemplate | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      setData(await getPortfolioContracts(organizationId));
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your contracts.");
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  const templates = useMemo(() => data?.templates ?? [], [data]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return needle ? templates.filter((row) => `${row.name} ${row.body}`.toLocaleLowerCase("en-GH").includes(needle)) : templates;
  }, [query, templates]);

  async function makeDefault(template: TermsTemplate) {
    if (!organizationId) return;
    setBusyId(template.id);
    try {
      await updateTermsTemplate(organizationId, template.id, { is_default: true });
      toast({ tone: "success", title: `“${template.name}” is now the default`, description: "New agreements start with it in Additional terms." });
      await load();
    } catch (cause) {
      toast({ tone: "error", title: "Couldn’t change the default", description: cause instanceof ApiFailure ? cause.error.message : "Try again." });
    } finally {
      setBusyId(null);
    }
  }

  const editorOpen = creating || Boolean(editing);
  const closeEditor = () => { setEditing(null); onCreatingChange(false); };

  return (
    <div className="docs-contracts">
      <ol className="docs-guide" aria-label="How an agreement is made">
        <GuideStep n={1} title="Approve a request" body="Its tenant and home carry into the agreement." />
        <GuideStep n={2} title="Prepare it" body="Set rent, term and duties; add your terms from a template." />
        <GuideStep n={3} title="Send it" body="The tenant reads and accepts it from their account." />
        <GuideStep n={4} title="It’s executed" body="Both acceptances are recorded and the wording locks." />
      </ol>

      {error && !data ? (
        <section className="ws-panel" aria-label="Contracts">
          <PanelState tone="error" icon="warning" title="Contracts didn’t load" body={error}
            action={<button type="button" className="ws-action" onClick={() => void load()}>Try again</button>} />
        </section>
      ) : null}

      {!organizationId || (!data && !error) ? (
        <section className="ws-panel" aria-busy="true" aria-label="Contracts"><PanelSkeleton rows={3} /></section>
      ) : null}

      {data ? (
        <>
          <AgreementCard agreement={data.agreement} onRead={() => setReading(true)} />

          <section className="ws-panel is-canvas docs-templates" aria-labelledby="docs-templates-title">
            <div className="ws-panel-head">
              <div className="docs-panel-title">
                <h2 id="docs-templates-title">Your terms templates</h2>
                <p>Reusable additional terms, filled with the agreement’s facts.</p>
              </div>
              {templates.length > 4 ? (
                <PanelSearch label="Search templates" placeholder="Search templates" value={query} onChange={setQuery} />
              ) : (
                <p className="ws-range"><strong>{templates.length}</strong> saved</p>
              )}
            </div>

            <div className="docs-template-grid">
              {visible.map((template, index) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  placeholders={data.placeholders}
                  order={index}
                  busy={busyId === template.id}
                  onEdit={() => setEditing(template)}
                  onDefault={() => void makeDefault(template)}
                  onDelete={() => setRemoving(template)}
                />
              ))}
              {query && !visible.length ? (
                <p className="docs-template-none">No template matches “{query}”.</p>
              ) : (
                <button type="button" className="docs-template-add" aria-haspopup="dialog" onClick={() => onCreatingChange(true)}>
                  <span className="docs-template-add-mark" aria-hidden="true"><Icon name="plus" /></span>
                  <strong>New template</strong>
                  <span>{templates.length ? "Write it here or import a Word document" : "Save the terms you add to every agreement — gate hours, the borehole, the generator"}</span>
                </button>
              )}
            </div>
          </section>

          <TemplateEditor
            open={editorOpen}
            template={editing}
            organizationId={organizationId}
            placeholders={data.placeholders}
            hasDefault={templates.some((row) => row.is_default && row.id !== editing?.id)}
            onClose={closeEditor}
            onSaved={async (saved, isNew) => {
              toast({ tone: "success", title: isNew ? "Template saved" : "Template updated", description: `“${saved.name}” is ready to use in the agreement builder.` });
              await load();
            }}
          />

          <ModalSheet
            open={reading}
            onClose={() => setReading(false)}
            icon="leases"
            title={data.agreement.title}
            meta={<>Version {data.agreement.version}<span className="doc-modal-sep" aria-hidden="true">·</span>{data.agreement.clauses.length} standard clauses</>}
            closeLabel="Close clauses"
          >
            <p className="docs-clauses-note">
              Danpa HQ writes these clauses and keeps them the same for every Portfolio. The <mark className="docs-ph">highlighted</mark> parts are the facts you set when you prepare an agreement.
            </p>
            <ol className="docs-clauses">
              {data.agreement.clauses.map((clause) => (
                <li key={clause.id}>
                  <h3>{clause.title}</h3>
                  <p><Wording text={clause.body} placeholders={data.placeholders} /></p>
                </li>
              ))}
            </ol>
          </ModalSheet>

          <ModalSheet
            open={Boolean(removing)}
            onClose={() => setRemoving(null)}
            icon="trash"
            size="sm"
            title={removing ? `Delete “${removing.name}”?` : "Delete template"}
            footer={(close) => (
              <>
                <button type="button" className="ws-action" onClick={close}>Keep it</button>
                <button
                  type="button"
                  className="ws-action is-danger"
                  disabled={busyId === removing?.id}
                  onClick={async () => {
                    if (!removing || !organizationId) return;
                    setBusyId(removing.id);
                    try {
                      await deleteTermsTemplate(organizationId, removing.id);
                      toast({ tone: "success", title: "Template deleted" });
                      close();
                      await load();
                    } catch (cause) {
                      toast({ tone: "error", title: "Couldn’t delete it", description: cause instanceof ApiFailure ? cause.error.message : "Try again." });
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  <Icon name="trash" />{busyId === removing?.id ? "Deleting…" : "Delete"}
                </button>
              </>
            )}
          >
            <p className="docs-confirm-copy">It leaves your library. Agreements already prepared with it keep their wording exactly as it was.</p>
          </ModalSheet>
        </>
      ) : null}
    </div>
  );
}

function GuideStep({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="docs-guide-step">
      <span className="docs-guide-n" aria-hidden="true">{n}</span>
      <span><strong>{title}</strong><small>{body}</small></span>
    </li>
  );
}

function AgreementCard({ agreement, onRead }: { agreement: PortfolioContracts["agreement"]; onRead: () => void }) {
  const reviewed = agreement.review_status === "approved_for_production";
  return (
    <section className="docs-agreement" aria-labelledby="docs-agreement-title">
      <span className="docs-paper" aria-hidden="true"><i /><i /><i /><i /><i /></span>
      <div className="docs-agreement-copy">
        <p className="docs-eyebrow">Danpa HQ agreement · controlled wording</p>
        <h2 id="docs-agreement-title">{agreement.title}</h2>
        <p className="docs-agreement-meta">
          Version {agreement.version}
          <span aria-hidden="true">·</span>
          {agreement.clauses.length} standard clauses
          <span aria-hidden="true">·</span>
          <span className={`docs-review${reviewed ? " is-reviewed" : ""}`}><i aria-hidden="true" />{reviewed ? "Legally reviewed" : "Legal review pending"}</span>
        </p>
      </div>
      <div className="docs-agreement-actions">
        <button type="button" className="ws-action" aria-haspopup="dialog" onClick={onRead}><Icon name="leases" />Read the clauses</button>
        <Link href={"/applications" as never} className="ws-action is-primary"><Icon name="applications" />Prepare from a request</Link>
      </div>
    </section>
  );
}

function TemplateCard({
  template,
  placeholders,
  order,
  busy,
  onEdit,
  onDefault,
  onDelete,
}: {
  template: TermsTemplate;
  placeholders: AgreementPlaceholder[];
  order: number;
  busy: boolean;
  onEdit: () => void;
  onDefault: () => void;
  onDelete: () => void;
}) {
  const used = new Set(Array.from(template.body.matchAll(PLACEHOLDER), (match) => match[1] ?? ""));
  return (
    <article className={`docs-template${template.is_default ? " is-default" : ""}`} style={{ "--docs-order": order } as React.CSSProperties} aria-busy={busy || undefined}>
      <div className="docs-template-top">
        <span className="docs-template-mark" aria-hidden="true"><Icon name="applications" /></span>
        {template.is_default ? <span className="docs-default"><Icon name="star" />Default</span> : null}
      </div>
      <h3>
        <button type="button" className="docs-template-open" aria-haspopup="dialog" onClick={onEdit}>{template.name}</button>
      </h3>
      <p className="docs-template-preview"><Wording text={template.body} placeholders={placeholders} /></p>
      <div className="docs-template-foot">
        <span>{used.size ? `${used.size} placeholder${used.size === 1 ? "" : "s"}` : "Plain wording"} · Updated {shortDate(template.updated_at)}</span>
        <span className="docs-template-actions">
          <button type="button" aria-label={`Edit ${template.name}`} title="Edit" onClick={onEdit}><Icon name="pencil" /></button>
          {template.is_default ? null : (
            <button type="button" aria-label={`Make ${template.name} the default`} title="Make default" disabled={busy} onClick={onDefault}><Icon name="star" /></button>
          )}
          <button type="button" className="is-danger" aria-label={`Delete ${template.name}`} title="Delete" onClick={onDelete}><Icon name="trash" /></button>
        </span>
      </div>
    </article>
  );
}

/** Wording with its placeholders drawn as the facts they stand for. */
function Wording({ text, placeholders, examples = false }: { text: string; placeholders: AgreementPlaceholder[]; examples?: boolean }) {
  const byName = new Map(placeholders.map((row) => [row.name, row]));
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const known = byName.get(match[1] ?? "");
    parts.push(
      known
        ? <mark key={at} className="docs-ph" title={`\${${known.name}}`}>{examples ? known.example : known.label}</mark>
        : <mark key={at} className="docs-ph is-unknown" title="Danpa HQ can’t fill this">{match[0]}</mark>,
    );
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function TemplateEditor({
  open,
  template,
  organizationId,
  placeholders,
  hasDefault,
  onClose,
  onSaved,
}: {
  open: boolean;
  template: TermsTemplate | null;
  organizationId: string | null;
  placeholders: AgreementPlaceholder[];
  hasDefault: boolean;
  onClose: () => void;
  onSaved: (template: TermsTemplate, isNew: boolean) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [imported, setImported] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? "");
    setBody(template?.body ?? "");
    setIsDefault(template?.is_default ?? !hasDefault);
    setMode("write");
    setError("");
    setImported("");
    // Reset once per opening, not whenever the library reloads beneath it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.id]);

  const known = useMemo(() => new Set(placeholders.map((row) => row.name)), [placeholders]);
  const unknown = useMemo(() => Array.from(new Set(Array.from(body.matchAll(PLACEHOLDER), (match) => match[1] ?? "").filter((key) => !known.has(key)))), [body, known]);
  const over = body.length > BODY_LIMIT;
  const ready = name.trim() && body.trim() && !unknown.length && !over;

  function insert(key: string) {
    const token = `\${${key}}`;
    const field = area.current;
    if (!field || mode !== "write") { setBody((current) => `${current}${token}`); return; }
    const start = field.selectionStart ?? body.length;
    const end = field.selectionEnd ?? body.length;
    const next = `${body.slice(0, start)}${token}${body.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function importWord(chosen: File) {
    setError("");
    try {
      const text = await readDocxText(chosen, known);
      if (!text) { setError("That document has no text to import."); return; }
      setBody((current) => (current.trim() ? `${current.trimEnd()}\n\n${text}` : text));
      if (!name.trim()) setName(chosen.name.replace(/\.docx$/i, "").slice(0, 120));
      setImported(chosen.name);
      setMode("write");
    } catch (cause) {
      setError(cause instanceof DocxError ? cause.message : "That document could not be read.");
    }
  }

  async function save() {
    if (!organizationId || !ready) return;
    setBusy(true);
    setError("");
    try {
      const input = { name: name.trim(), body: body.trim(), is_default: isDefault };
      const saved = template
        ? await updateTermsTemplate(organizationId, template.id, input)
        : await createTermsTemplate(organizationId, input);
      await onSaved(saved, !template);
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "The template didn’t save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      icon={template ? "pencil" : "plus"}
      title={template ? "Edit template" : "New template"}
      meta="Added to an agreement as clearly labelled custom terms"
      closeLabel="Close template"
      className="docs-editor"
      footer={(close) => (
        <>
          <span className="doc-modal-foot-note">Danpa HQ’s standard clauses are never changed.</span>
          <button type="button" className="ws-action" onClick={close}>Cancel</button>
          <button type="button" className="ws-action is-primary" disabled={!ready || busy} onClick={() => void save()}>
            {busy ? "Saving…" : template ? "Save changes" : "Save template"}
          </button>
        </>
      )}
    >
      <div className="docs-editor-row">
        <label className="docs-field">
          <span>Template name</span>
          <input value={name} maxLength={120} placeholder="e.g. Compound rules" onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="docs-check">
          <Check checked={isDefault} onChange={setIsDefault} label="Start new agreements with it" />
        </div>
      </div>

      <div className="docs-editor-bar">
        <div className="docs-tabs" role="tablist" aria-label="Template view">
          <button type="button" role="tab" aria-selected={mode === "write"} onClick={() => setMode("write")}>Write</button>
          <button type="button" role="tab" aria-selected={mode === "preview"} onClick={() => setMode("preview")}>Preview</button>
        </div>
        <button type="button" className="docs-import" onClick={() => file.current?.click()}><Icon name="upload" />Import from Word</button>
        <input
          ref={file}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          hidden
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = "";
            if (chosen) void importWord(chosen);
          }}
        />
      </div>

      <div className="docs-placeholders" aria-label="Insert a placeholder">
        <span>Insert</span>
        <div>
          {placeholders.map((row) => (
            <button key={row.name} type="button" title={`\${${row.name}} — e.g. ${row.example}`} onClick={() => insert(row.name)}>{row.label}</button>
          ))}
        </div>
      </div>

      {mode === "write" ? (
        <label className="docs-body">
          <span className="sr-only">Terms</span>
          <textarea
            ref={area}
            value={body}
            rows={11}
            placeholder={"The compound gate is locked at 11pm. ${tenant_name} keeps the borehole pump serviced."}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
      ) : (
        <article className="docs-preview" aria-label="Preview">
          <h3>Custom term — {name.trim() || "Untitled"}</h3>
          {body.trim()
            ? body.trim().split(/\n{2,}/).map((paragraph, index) => <p key={index}><Wording text={paragraph} placeholders={placeholders} examples /></p>)
            : <p className="docs-preview-empty">Nothing written yet.</p>}
          <small>Example facts shown. Each agreement fills its own.</small>
        </article>
      )}

      <div className="docs-editor-status">
        {unknown.length ? (
          <span className="is-error" role="alert">{unknown.map((key) => `\${${key}}`).join(", ")} {unknown.length === 1 ? "isn’t a placeholder" : "aren’t placeholders"} Danpa HQ can fill.</span>
        ) : imported ? (
          <span>Imported from {imported}. Formatting isn’t kept; check the wording.</span>
        ) : <span />}
        <span className={over ? "is-error" : undefined}>{body.length.toLocaleString("en-GH")} / {BODY_LIMIT.toLocaleString("en-GH")}</span>
      </div>
      {error ? <p className="docs-editor-error" role="alert">{error}</p> : null}
    </ModalSheet>
  );
}

function shortDate(value: string) {
  return new Date(value).toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}
