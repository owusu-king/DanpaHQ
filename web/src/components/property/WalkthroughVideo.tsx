"use client";

import { useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/auth";
import { ApiFailure } from "@/lib/api";
import { validateVideo, videoPath, videoUpload, type VideoSubject, type WalkthroughVideo } from "@/lib/propertyVideo";

export function VideoPlayer({ video, label = "Video", caption = false }: { video?: WalkthroughVideo | null; label?: string; caption?: boolean }) {
  if (!video) return null;
  const player = <video key={video.url} controls playsInline preload="metadata" aria-label={label} src={video.url} style={{ display: "block", width: "100%", maxHeight: 360, background: "#17291f", borderRadius: "var(--radius-md)", objectFit: "contain" }} />;
  return caption ? <figure style={{ margin: 0, display: "grid", gap: "var(--space-2)" }}><figcaption className="type-caption">{label}</figcaption>{player}</figure> : player;
}

export function WalkthroughUpload({ subject, id, editable, onBusy }: { subject: VideoSubject; id: string; editable: boolean; onBusy?: (busy: boolean) => void }) {
  const [saved, setSaved] = useState<WalkthroughVideo | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryAvailable, setRetryAvailable] = useState(false);
  const retry = useRef<(() => Promise<string>) | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const version = useRef(0);
  useEffect(() => { let live = true; const requestedVersion = version.current; authedFetch<WalkthroughVideo | null>(videoPath(subject, id)).then(video => { if (live && version.current === requestedVersion) setSaved(video); }).catch(() => { if (live && version.current === requestedVersion) setError("Could not load the video."); }); return () => { live = false; }; }, [id, subject]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function act(run: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); onBusy?.(true); setError("");
    try { await run(); } catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : cause instanceof Error ? cause.message : "Video upload failed. Try again."); }
    finally { running.current = false; setBusy(false); onBusy?.(false); }
  }
  async function save() {
    const fileId = await retry.current!();
    const next = await authedFetch<WalkthroughVideo>(videoPath(subject, id), { method: "PUT", body: JSON.stringify({ file_id: fileId }) });
    version.current++; setSaved(next); setPreview(""); retry.current = null; setRetryAvailable(false);
  }
  async function choose(file?: File) {
    if (!file) return;
    await act(async () => {
      await validateVideo(file);
      setPreview(URL.createObjectURL(file)); retry.current = videoUpload(file, subject); setRetryAvailable(true);
      await save();
    });
  }
  if (!editable && !saved && !preview && !error) return null;
  return <div style={{ display: "grid", gap: "var(--space-2)", minWidth: 0 }}>
    <strong className="type-body-strong">Video (optional)</strong>
    <span className="type-caption">Up to 10 seconds · 30MB · MP4, MOV or WebM</span>
    {preview ? <video src={preview} controls playsInline preload="metadata" aria-label="Video preview" style={{ width: "100%", maxHeight: 280 }} /> : <VideoPlayer video={saved} label={`${subject === "property" ? "Property" : "Unit"} video`} />}
    {error ? <p role="alert" className="type-caption">{error}</p> : null}
    {editable ? <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
      <input ref={input} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" hidden onChange={event => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
      <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Uploading…" : preview || saved ? "Replace video" : "Add video"}</button>
      {error && retryAvailable ? <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void act(save)}>Retry</button> : null}
      {preview || saved ? <button className="btn btn-quiet" type="button" disabled={busy} onClick={() => void act(async () => { await authedFetch(videoPath(subject, id), { method: "DELETE" }); version.current++; setSaved(null); setPreview(""); retry.current = null; setRetryAvailable(false); })}>Remove video</button> : null}
    </div> : null}
  </div>;
}
