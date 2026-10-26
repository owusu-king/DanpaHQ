"use client";

/**
 * Reporting a problem: which home, what kind, what is wrong, one photograph,
 * and — if it helps — up to five seconds of video.
 *
 * Everything happens in this one sheet. Recording a clip and trimming a longer
 * one are *steps* of the form, shown in place of the clip field, never a
 * dialog over it. The photograph is required and says so; the clip is optional
 * and says that too.
 *
 * Files go through the product's own upload pipeline (`uploadFile`): reserved,
 * sent straight to storage, then checked for what they really are before the
 * request may point at them.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure } from "@/lib/api";
import { uploadFile } from "@/lib/console";
import {
  CATEGORIES,
  MAX_CLIP_MS,
  submitMaintenanceRequest,
  type MaintenanceCategory,
  type MaintenanceRequest,
} from "@/lib/maintenance";
import type { Tenancy } from "@/lib/tenancy";
import { canRecordInBrowser, clipFile, cutClip, recordingType, seconds, videoDuration } from "@/lib/videoClip";

type Clip = { file: File; url: string; durationMs: number };

export function ReportSheet({
  open,
  tenancies,
  initialTenancyId,
  onClose,
  onSent,
}: {
  open: boolean;
  /** Active tenancies only: a request needs somewhere to send it. */
  tenancies: Tenancy[];
  initialTenancyId?: string;
  onClose: () => void;
  onSent: (request: MaintenanceRequest) => void | Promise<void>;
}) {
  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      size="sm"
      icon="wrench"
      title="Report a problem"
      meta="Your landlord is told as soon as you send it."
      className="request-sheet mt-sheet mt-report-sheet"
      closeLabel="Close report"
    >
      {(close) => open ? (
        <ReportForm tenancies={tenancies} initialTenancyId={initialTenancyId} onCancel={close} onSent={async (request) => { await onSent(request); close(); }} />
      ) : null}
    </ModalSheet>
  );
}

function ReportForm({
  tenancies,
  initialTenancyId,
  onCancel,
  onSent,
}: {
  tenancies: Tenancy[];
  initialTenancyId?: string;
  onCancel: () => void;
  onSent: (request: MaintenanceRequest) => void | Promise<void>;
}) {
  const [tenancyId, setTenancyId] = useState(
    tenancies.find((row) => row.id === initialTenancyId)?.id ?? tenancies[0]?.id ?? "",
  );
  const [category, setCategory] = useState<MaintenanceCategory | "">("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [clipStep, setClipStep] = useState<"idle" | "record" | { trim: File; durationMs: number }>("idle");
  const [stage, setStage] = useState<"" | "photo" | "clip" | "sending">("");
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);

  // Object URLs are released when they stop being shown.
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.url); }, [clip]);

  const missing = {
    category: !category,
    description: description.trim().length < 10,
    photo: !photo,
  };
  const ready = tenancyId && !missing.category && !missing.description && !missing.photo && clipStep === "idle";

  async function send() {
    setAttempted(true);
    if (!ready || !photo || !category) return;
    setError("");
    try {
      setStage("photo");
      const storedPhoto = await uploadFile(photo.file, "maintenance_photo");
      if (!storedPhoto.is_usable) throw new Error(storedPhoto.rejection_reason || storedPhoto.status_message || "The photo is still being checked. Try again in a moment.");
      let videoId: string | null = null;
      if (clip) {
        setStage("clip");
        const storedClip = await uploadFile(clip.file, "maintenance_video");
        if (!storedClip.is_usable) throw new Error(storedClip.rejection_reason || storedClip.status_message || "The clip is still being checked. Try again in a moment.");
        videoId = storedClip.id;
      }
      setStage("sending");
      const created = await submitMaintenanceRequest({
        tenancy_id: tenancyId,
        category,
        description: description.trim(),
        photo_file_id: storedPhoto.id,
        video_file_id: videoId,
        video_duration_ms: clip?.durationMs ?? null,
      });
      await onSent(created);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : cause instanceof Error ? cause.message : "Your report did not send. Try again.");
    } finally {
      setStage("");
    }
  }

  const busy = Boolean(stage);

  return (
    <div className="rq mt-form" aria-busy={busy || undefined}>
      {tenancies.length > 1 ? (
        <fieldset className="mt-field">
          <legend>Which home?</legend>
          <div className="lw-chips">
            {tenancies.map((row) => (
              <button
                key={row.id}
                type="button"
                className="lw-chip-button"
                aria-pressed={tenancyId === row.id}
                onClick={() => setTenancyId(row.id)}
              >
                <Icon name="home" />{row.space.unit_label}<em>{row.property.title}</em>
              </button>
            ))}
          </div>
        </fieldset>
      ) : tenancies[0] ? (
        <p className="mt-home"><Icon name="home" /><span><strong>{tenancies[0].space.unit_label}</strong>{tenancies[0].property.title}</span></p>
      ) : null}

      <fieldset className="mt-field" data-invalid={attempted && missing.category || undefined}>
        <legend>What kind of problem?</legend>
        <div className="lw-chips">
          {CATEGORIES.map((option) => (
            <button
              key={option.value}
              type="button"
              className="lw-chip-button"
              aria-pressed={category === option.value}
              onClick={() => setCategory(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-field" data-invalid={attempted && missing.description || undefined}>
        <label htmlFor="mt-description">What is wrong?</label>
        <textarea
          id="mt-description"
          className="lw-textarea"
          rows={4}
          maxLength={2000}
          value={description}
          placeholder="Where it is, what happens, and since when. For example: the kitchen tap drips all night and water collects under the sink."
          onChange={(event) => setDescription(event.target.value)}
        />
        {attempted && missing.description ? <small className="mt-hint is-error">Describe it in a sentence or two.</small> : null}
      </div>

      <PhotoField photo={photo} invalid={attempted && missing.photo} disabled={busy} onPhoto={setPhoto} />

      {clipStep === "record" ? (
        <Recorder
          onCancel={() => setClipStep("idle")}
          onDone={(next) => { setClip(next); setClipStep("idle"); }}
        />
      ) : typeof clipStep === "object" ? (
        <Trimmer
          source={clipStep.trim}
          durationMs={clipStep.durationMs}
          onCancel={() => setClipStep("idle")}
          onDone={(next) => { setClip(next); setClipStep("idle"); }}
        />
      ) : (
        <ClipField
          clip={clip}
          disabled={busy}
          onRecord={() => setClipStep("record")}
          onFile={async (file) => {
            setError("");
            try {
              const durationMs = await videoDuration(file);
              if (durationMs > MAX_CLIP_MS) setClipStep({ trim: file, durationMs });
              else setClip({ file, url: URL.createObjectURL(file), durationMs });
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "We could not read that video.");
            }
          }}
          onRemove={() => setClip(null)}
        />
      )}

      {error ? <Notice tone="error" title={error} /> : null}

      <div className="rq-actions">
        <Button busy={busy} busyLabel={{ photo: "Uploading photo…", clip: "Uploading clip…", sending: "Sending…", "": "" }[stage]} disabled={clipStep !== "idle"} onClick={() => void send()}>
          <Icon name="wrench" />Send report
        </Button>
        <Button variant="quiet" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// --- the photograph -------------------------------------------------------------

function PhotoField({
  photo,
  invalid,
  disabled,
  onPhoto,
}: {
  photo: { file: File; url: string } | null;
  invalid: boolean;
  disabled: boolean;
  onPhoto: (next: { file: File; url: string } | null) => void;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const take = (file: File | undefined) => { if (file) onPhoto({ file, url: URL.createObjectURL(file) }); };
  return (
    <div className="mt-field" data-invalid={invalid || undefined}>
      <span className="mt-label">Photo <em>Required · one</em></span>
      {photo ? (
        <div className="mt-preview">
          {/* A local object URL: the photo has not left the device yet. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt="The photo you chose" />
          <button type="button" className="mt-preview-remove" disabled={disabled} onClick={() => onPhoto(null)} aria-label="Remove photo">
            <Icon name="close" />
          </button>
        </div>
      ) : (
        <div className="mt-pick">
          <button type="button" className="mt-pick-tile" onClick={() => camera.current?.click()}>
            <Icon name="photos" /><strong>Take a photo</strong><small>Uses your camera</small>
          </button>
          <button type="button" className="mt-pick-tile" onClick={() => library.current?.click()}>
            <Icon name="upload" /><strong>Upload a photo</strong><small>JPEG, PNG, WebP or HEIC</small>
          </button>
        </div>
      )}
      {invalid ? <small className="mt-hint is-error">Add one photo of the problem.</small> : null}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { take(event.target.files?.[0]); event.target.value = ""; }} />
      <input ref={library} type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden onChange={(event) => { take(event.target.files?.[0]); event.target.value = ""; }} />
    </div>
  );
}

// --- the clip ---------------------------------------------------------------------

function ClipField({
  clip,
  disabled,
  onRecord,
  onFile,
  onRemove,
}: {
  clip: Clip | null;
  disabled: boolean;
  onRecord: () => void;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  const library = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-field">
      <span className="mt-label">Video <em>Optional · up to 5 seconds</em></span>
      {clip ? (
        <div className="mt-preview is-video">
          <video src={clip.url} controls playsInline preload="metadata" aria-label="Your clip" />
          <span className="mt-preview-badge">{seconds(clip.durationMs)}s</span>
          <button type="button" className="mt-preview-remove" disabled={disabled} onClick={onRemove} aria-label="Remove clip">
            <Icon name="close" />
          </button>
        </div>
      ) : (
        <div className="mt-pick">
          <button
            type="button"
            className="mt-pick-tile"
            // In the sheet where the browser can record; the phone's own camera
            // (which a phone browser opens for `capture`) where it cannot.
            onClick={() => (canRecordInBrowser() ? onRecord() : camera.current?.click())}
          >
            <Icon name="video" /><strong>Record a clip</strong><small>Stops at 5 seconds</small>
          </button>
          <button type="button" className="mt-pick-tile" onClick={() => library.current?.click()}>
            <Icon name="upload" /><strong>Upload a video</strong><small>Longer ones are trimmed to 5s</small>
          </button>
        </div>
      )}
      <input ref={library} type="file" accept="video/mp4,video/quicktime,video/webm" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onFile(file); }} />
      <input ref={camera} type="file" accept="video/*" capture="environment" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onFile(file); }} />
    </div>
  );
}

/** Recording in the sheet: a live preview, one button, and a hard stop at five seconds. */
function Recorder({ onCancel, onDone }: { onCancel: () => void; onDone: (clip: Clip) => void }) {
  const preview = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const [state, setState] = useState<"starting" | "ready" | "recording" | "failed">("starting");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: true })
      .catch(() => navigator.mediaDevices.getUserMedia({ video: true }))
      .then((media) => {
        if (!live) { media.getTracks().forEach((track) => track.stop()); return; }
        stream.current = media;
        if (preview.current) preview.current.srcObject = media;
        setState("ready");
      })
      .catch(() => {
        if (!live) return;
        setState("failed");
        setError("We could not open your camera. Allow camera access, or upload a video instead.");
      });
    return () => {
      live = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function start() {
    if (!stream.current) return;
    const type = recordingType();
    const chunks: Blob[] = [];
    const media = new MediaRecorder(stream.current, type ? { mimeType: type } : undefined);
    recorder.current = media;
    const startedAt = performance.now();
    media.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    media.onstop = () => {
      const durationMs = Math.min(MAX_CLIP_MS, Math.round(performance.now() - startedAt));
      const file = clipFile(new Blob(chunks, { type: (type || "video/webm").split(";")[0] }), "recording");
      stream.current?.getTracks().forEach((track) => track.stop());
      onDone({ file, url: URL.createObjectURL(file), durationMs });
    };
    media.start(250);
    setState("recording");
    const timer = window.setInterval(() => {
      const ms = performance.now() - startedAt;
      setElapsed(Math.min(ms, MAX_CLIP_MS));
      if (ms >= MAX_CLIP_MS) {
        window.clearInterval(timer);
        if (media.state === "recording") media.stop();
      }
    }, 100);
    media.addEventListener("stop", () => window.clearInterval(timer));
  }

  return (
    <div className="mt-field">
      <span className="mt-label">Video <em>Recording · up to 5 seconds</em></span>
      <div className="mt-recorder" data-state={state}>
        <video ref={preview} autoPlay muted playsInline aria-label="Camera preview" />
        {state === "recording" ? (
          <span className="mt-recorder-time" aria-live="polite">
            <i aria-hidden="true" />{seconds(elapsed)}s / 5.0s
          </span>
        ) : null}
        <span className="mt-recorder-bar" aria-hidden="true"><i style={{ width: `${(elapsed / MAX_CLIP_MS) * 100}%` }} /></span>
      </div>
      {error ? <Notice tone="error" title={error} /> : null}
      <div className="mt-step-actions">
        {state === "recording" ? (
          <Button variant="secondary" onClick={() => recorder.current?.stop()}>Stop</Button>
        ) : (
          <Button variant="secondary" disabled={state !== "ready"} onClick={start}><Icon name="video" />Record</Button>
        )}
        <Button variant="quiet" disabled={state === "recording"} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/**
 * Choosing five seconds of a longer video: the video loops through the window
 * as it moves, so what is kept is what was watched. "Use these 5 seconds"
 * records the window into a new clip (`cutClip`) — the long file never leaves
 * the device.
 */
function Trimmer({
  source,
  durationMs,
  onCancel,
  onDone,
}: {
  source: File;
  durationMs: number;
  onCancel: () => void;
  onDone: (clip: Clip) => void;
}) {
  const url = useMemo(() => URL.createObjectURL(source), [source]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const video = useRef<HTMLVideoElement>(null);
  const span = Math.min(MAX_CLIP_MS, durationMs);
  const latest = Math.max(0, durationMs - span);
  const [startMs, setStartMs] = useState(0);
  const [cutting, setCutting] = useState<number | null>(null);
  const [error, setError] = useState("");
  const endMs = startMs + span;

  // Keep the preview inside the window.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.currentTime = startMs / 1000;
    void element.play().catch(() => undefined);
  }, [startMs]);

  async function use() {
    setError("");
    setCutting(0);
    video.current?.pause();
    try {
      const file = await cutClip(source, startMs, endMs, setCutting);
      onDone({ file, url: URL.createObjectURL(file), durationMs: span });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not cut that video.");
      setCutting(null);
    }
  }

  const left = (startMs / durationMs) * 100;
  const width = (span / durationMs) * 100;

  return (
    <div className="mt-field">
      <span className="mt-label">Video <em>Choose 5 seconds of {Math.round(durationMs / 1000)}s</em></span>
      <div className="mt-trim">
        <video
          ref={video}
          src={url}
          muted
          playsInline
          preload="auto"
          onTimeUpdate={(event) => {
            const element = event.currentTarget;
            if (element.currentTime >= endMs / 1000) element.currentTime = startMs / 1000;
          }}
          aria-label="Preview of the part you are keeping"
        />
        <div className="mt-trim-rail">
          <span className="mt-trim-window" style={{ left: `${left}%`, width: `${width}%` }} aria-hidden="true" />
          <input
            type="range"
            min={0}
            max={latest}
            step={100}
            value={startMs}
            disabled={cutting !== null || latest === 0}
            onChange={(event) => setStartMs(Number(event.target.value))}
            aria-label="Where the five seconds start"
            aria-valuetext={`${clock(startMs)} to ${clock(endMs)}`}
          />
        </div>
        <p className="mt-trim-times"><span>{clock(startMs)}</span><strong>{clock(startMs)} – {clock(endMs)}</strong><span>{clock(durationMs)}</span></p>
        {cutting !== null ? (
          <span className="mt-recorder-bar is-cutting" aria-hidden="true"><i style={{ width: `${cutting * 100}%` }} /></span>
        ) : null}
      </div>
      {error ? <Notice tone="error" title={error} /> : null}
      <div className="mt-step-actions">
        <Button variant="secondary" busy={cutting !== null} busyLabel="Cutting the clip…" onClick={() => void use()}>
          <Icon name="check" />Use these 5 seconds
        </Button>
        <Button variant="quiet" disabled={cutting !== null} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function clock(ms: number) {
  const total = Math.round(ms / 100) / 10;
  const minutes = Math.floor(total / 60);
  const rest = (total - minutes * 60).toLocaleString("en-GH", { minimumFractionDigits: 1, maximumFractionDigits: 1, minimumIntegerDigits: 2 });
  return `${minutes}:${rest}`;
}
