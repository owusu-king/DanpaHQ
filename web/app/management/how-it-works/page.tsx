"use client";
import { useState } from "react";
import { ArrowUp, ArrowDown, Trash2, Upload, X, Plus } from "lucide-react";
import { Check } from "@/components/Check";
import { Feedback, PageHeader, Panel, ResourceState, useResource } from "@/components/management/ManagementUI";
import { managementFetch, useManagement } from "@/lib/management";
import { uploadGuideAsset } from "@/lib/guideUploads";
import type { GuideDraft, GuideEditorData } from "@/lib/videoGuides";

type AssetField = "video_file_id" | "thumbnail_file_id" | "captions_file_id";
const message = (error: unknown) => error instanceof Error ? error.message : "That change could not be saved.";
function submission(guide: GuideDraft) {
  const { id, title, description, url, published, video_file_id, thumbnail_file_id, captions_file_id } = guide;
  return { id, title, description, url, published, video_file_id, thumbnail_file_id, captions_file_id };
}

export default function GuidesPage() {
  const { can } = useManagement();
  const resource = useResource<GuideEditorData>("/how-it-works/");
  return <><PageHeader title="How It Works" />
    {!can("manage_configuration") ? <Feedback error="Your Management role cannot edit these guides." /> : resource.data ? <GuideEditor key={resource.data.revision} initial={resource.data} /> : <Panel><ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} /></Panel>}
  </>;
}
function GuideEditor({ initial }: { initial: GuideEditorData }) {
  const [saved, setSaved] = useState(initial);
  const [guides, setGuides] = useState(initial.guides);
  const [selected, setSelected] = useState(initial.guides[0]?.id ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const current = guides.find(guide => guide.id === selected);
  const index = guides.findIndex(guide => guide.id === selected);
  const locked = saving || Boolean(uploading);
  function edit(values: Partial<GuideDraft>) {
    setGuides(rows => rows.map(row => row.id === selected ? { ...row, ...values } : row));
    setDirty(true); setSuccess(""); setError("");
  }
  function move(direction: number) {
    const rows = [...guides];
    [rows[index], rows[index + direction]] = [rows[index + direction]!, rows[index]!];
    setGuides(rows); setDirty(true); setSuccess("");
  }
  async function upload(file: File, field: AssetField) {
    setError(""); setSuccess("");
    try {
      const purpose = field === "video_file_id" ? "guide_video" : field === "thumbnail_file_id" ? "guide_thumbnail" : "guide_captions";
      const id = await uploadGuideAsset(file, purpose, setUploading);
      edit({ [field]: id, ...(field === "video_file_id" ? { url: "" } : {}) });
    } catch (cause) { setError(message(cause)); } finally { setUploading(""); }
  }
  async function save() {
    const missing = guides.find(guide => !guide.title.trim());
    if (missing) { setSelected(missing.id); setError("Give this chapter a title before saving."); document.getElementById("guide-title")?.focus(); return; }
    setSaving(true); setError(""); setSuccess("");
    try {
      const result = await managementFetch<GuideEditorData>("/how-it-works/", { method: "PUT", body: JSON.stringify({ revision: saved.revision, guides: guides.map(submission) }) });
      setSaved(result); setGuides(result.guides); setDirty(false); setSuccess("Guides saved. Published chapters are now visible on How It Works.");
    } catch (cause) { setError(message(cause)); } finally { setSaving(false); }
  }
  return <>
    <Feedback error={error} success={success} />
    <div className="management-guide-save"><span role="status">{uploading || (dirty ? "Unsaved changes" : "All changes saved")}</span><button type="button" className="management-button quiet" aria-label="Discard changes" disabled={locked || !dirty} onClick={() => { setGuides(saved.guides); setSelected(saved.guides[0]?.id ?? ""); setDirty(false); setError(""); setSuccess(""); }}>Discard</button><button type="button" className="management-button primary" disabled={locked || !dirty} onClick={() => void save()}>{saving ? "Saving…" : "Save guides"}</button></div>
    <div className="management-guide-layout">
      <aside className="management-guide-chapters" aria-label="Chapters">
        <div className="management-guide-list-head"><strong>Chapters</strong><span>{guides.length} / 10</span></div>
        <ol>{guides.map((guide, position) => <li key={guide.id}><button type="button" aria-label={`${String(position + 1).padStart(2, "0")} ${guide.title || "Untitled chapter"}, ${guide.published ? "Published" : "Draft"}`} aria-pressed={selected === guide.id} disabled={locked} onClick={() => { setSelected(guide.id); setError(""); }}><span aria-hidden="true">{String(position + 1).padStart(2, "0")}</span><strong>{guide.title || "Untitled chapter"}</strong>{!guide.published ? <small>Draft</small> : null}</button></li>)}</ol>
        <button type="button" className="management-button quiet" aria-label="Add chapter" disabled={locked || guides.length >= 10} onClick={() => { const id = crypto.randomUUID(); setGuides(rows => [...rows, { id, title: "New chapter", description: "", url: "", published: false, src: null, kind: "video", video_file_id: null, thumbnail_file_id: null, captions_file_id: null }]); setSelected(id); setDirty(true); setSuccess(""); }}><Plus aria-hidden="true" />Add chapter</button>
      </aside>
      <Panel title={current ? `Chapter ${String(index + 1).padStart(2, "0")}` : "Your guides"} actions={current ? <div className="management-guide-tools">
        <Check label="Published" checked={current.published} disabled={locked} onChange={published => edit({ published })} />
        <div className="management-guide-order"><button className="management-button quiet management-guide-icon" type="button" aria-label="Move up" title="Move up" disabled={locked || index <= 0} onClick={() => move(-1)}><ArrowUp aria-hidden="true" /></button><button className="management-button quiet management-guide-icon" type="button" aria-label="Move down" title="Move down" disabled={locked || index >= guides.length - 1} onClick={() => move(1)}><ArrowDown aria-hidden="true" /></button><button className="management-button quiet danger management-guide-icon" type="button" aria-label="Remove chapter" title="Remove chapter" disabled={locked} onClick={() => { setGuides(rows => rows.filter(row => row.id !== selected)); setSelected(guides[index + 1]?.id ?? guides[index - 1]?.id ?? ""); setDirty(true); setError(""); setSuccess(""); }}><Trash2 aria-hidden="true" /></button></div>
      </div> : null}>
        {current ? <form className="management-guide-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset disabled={locked} className="management-guide-fields">
            <div className="management-guide-row">
              <label className="management-field">Title<input id="guide-title" maxLength={120} value={current.title} onChange={event => edit({ title: event.target.value })} /></label>
              <div className="management-field"><label htmlFor="guide-description">Description (optional)</label><textarea id="guide-description" maxLength={500} rows={3} value={current.description} onChange={event => edit({ description: event.target.value })} /></div>
            </div>
            <div className="management-guide-source-row">
              <label className="management-field">Video link<input id="guide-video-link" aria-describedby="guide-link-hint" inputMode="url" value={current.url} placeholder="YouTube, Vimeo or an HTTPS MP4/WebM link" onChange={event => edit({ url: event.target.value, video_file_id: null })} /></label>
            </div>
            <p id="guide-link-hint" className="management-hint">{current.video_file_id ? "Uploaded video selected. Entering a link will replace it." : "Use a video link or upload a file. The video host must allow embedding."}</p>
            <div className="management-guide-extra-assets">
              <GuideAsset label="Upload video" accept=".mp4,.webm" attached={Boolean(current.video_file_id)} disabled={locked} removeLabel="Remove video" onSelect={file => void upload(file, "video_file_id")} onRemove={() => edit({ video_file_id: null })} />
              <GuideAsset label="Thumbnail (optional)" accept=".jpg,.jpeg,.png,.webp" attached={Boolean(current.thumbnail_file_id)} disabled={locked} removeLabel="Remove thumbnail" onSelect={file => void upload(file, "thumbnail_file_id")} onRemove={() => edit({ thumbnail_file_id: null })} />
              <GuideAsset label="English captions (optional)" accept=".vtt" attached={Boolean(current.captions_file_id)} disabled={locked} removeLabel="Remove captions" onSelect={file => void upload(file, "captions_file_id")} onRemove={() => edit({ captions_file_id: null })} />
            </div>
          </fieldset>
        </form> : <p className="management-guide-empty">Add a chapter to begin.</p>}
      </Panel>
    </div>
  </>;
}

function GuideAsset({ label, accept, attached, disabled, removeLabel, onSelect, onRemove }: {
  label: string; accept: string; attached: boolean; disabled: boolean; removeLabel: string;
  onSelect: (file: File) => void; onRemove: () => void;
}) {
  return <div className="management-guide-asset"><div className="management-guide-asset-heading"><span>{label}</span></div><div className="management-guide-asset-row">
    <label className={`management-guide-pick${disabled ? " is-disabled" : ""}`}><Upload aria-hidden="true" /><span>{attached ? "Replace" : "Choose file"}</span><input className="sr-only" type="file" aria-label={label} accept={accept} disabled={disabled} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onSelect(file); }} /></label>
    {attached ? <><button type="button" className="management-button quiet management-guide-icon" aria-label={removeLabel} title={removeLabel} disabled={disabled} onClick={onRemove}><X aria-hidden="true" /></button></> : null}
  </div></div>;
}
