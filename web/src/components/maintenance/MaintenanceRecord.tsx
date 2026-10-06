"use client";

/**
 * One maintenance request, as both sides read it, in one sheet over the list.
 *
 * Read top to bottom: what it is and where it stands; the photograph and the
 * clip; how far it has come (four stops); what the tenant said; what has
 * happened since, with each note beside the move it explains. The foot holds
 * at most two buttons — the move this reader may make now and, where a move
 * needs words, the way back out of writing them. Which moves exist comes from
 * the server (`permissions`), never worked out here.
 *
 * Nothing opens a second sheet; asking for a note happens in place.
 */

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Icon, type IconName } from "@/components/portal/icons";
import { useToast } from "@/components/toast/Toaster";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure } from "@/lib/api";
import {
  getMaintenanceRequest,
  maintenanceStatusLabel,
  maintenanceStops,
  maintenanceTone,
  moveMaintenanceRequest,
  type MaintenanceEvent,
  type MaintenanceRequest,
} from "@/lib/maintenance";
import { onDate } from "@/lib/time";

type Side = "tenant" | "provider";

export function MaintenanceSheet({
  requestId,
  side,
  onClose,
  onChanged,
}: {
  requestId: string | null;
  side: Side;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [request, setRequest] = useState<MaintenanceRequest | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!requestId) return;
    let live = true;
    setError("");
    getMaintenanceRequest(requestId)
      .then((row) => { if (live) setRequest(row); })
      .catch((cause) => { if (live) setError(cause instanceof ApiFailure ? cause.error.message : "This request didn’t open."); });
    return () => { live = false; };
  }, [requestId]);

  const shown = request && request.id === requestId ? request : null;

  return (
    <ModalSheet
      open={Boolean(requestId)}
      onClose={onClose}
      size="sm"
      icon="wrench"
      title={shown ? shown.category_display : "Maintenance"}
      meta={shown ? placeLine(shown, side) : error ? undefined : "Opening…"}
      className="request-sheet mt-sheet"
      closeLabel="Close maintenance request"
      bodyBusy={!shown && !error}
    >
      {error ? (
        <div className="doc-modal-state" role="alert"><strong>This request didn’t open</strong><span>{error}</span></div>
      ) : shown ? (
        <MaintenanceRecord
          key={shown.id}
          request={shown}
          side={side}
          onChanged={async (next) => { setRequest(next); await onChanged(); }}
        />
      ) : (
        <div className="doc-modal-skeleton" aria-hidden="true">
          <span className="ws-skeleton-block" style={{ height: "12rem" }} />
          <span className="ws-skeleton-block" style={{ width: "60%" }} />
          <span className="ws-skeleton-block is-thin" style={{ width: "80%" }} />
        </div>
      )}
    </ModalSheet>
  );
}

function placeLine(request: MaintenanceRequest, side: Side) {
  const place = [request.place.unit_label, request.place.bed_label, request.place.property_title].filter(Boolean).join(" · ");
  return side === "provider" ? `${request.tenant.name} · ${place}` : place;
}

export function MaintenanceRecord({
  request,
  side,
  onChanged,
}: {
  request: MaintenanceRequest;
  side: Side;
  onChanged: (next: MaintenanceRequest) => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [writing, setWriting] = useState<"fixed" | "reopen" | null>(null);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const can = request.permissions ?? { start: false, report_fixed: false, confirm: false, reopen: false };
  const tone = maintenanceTone(request.status);

  async function move(kind: "start" | "fixed" | "confirm" | "reopen") {
    setBusy(true);
    setError("");
    try {
      const body = kind === "reopen" ? { reason: words.trim() } : kind === "fixed" ? { note: words.trim() } : {};
      const next = await moveMaintenanceRequest(request.id, kind, body);
      setWriting(null);
      setWords("");
      await onChanged(next);
      toast({
        tone: "success",
        title: {
          start: "Work started",
          fixed: "Sent to the tenant to confirm",
          confirm: "Marked as fixed",
          reopen: "Request reopened",
        }[kind],
      });
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rq mt" aria-busy={busy || undefined}>
      <section className="mt-hero" data-tone={tone} aria-label="Where it stands">
        <span className="mt-hero-mark" aria-hidden="true"><Icon name={toneIcon(tone)} /></span>
        <span className="mt-hero-copy">
          <strong>{maintenanceStatusLabel(request.status, side)}</strong>
          <small>{heroLine(request, side)}</small>
        </span>
        {request.reopen_count ? <span className="mt-reopened">Reopened {request.reopen_count}×</span> : null}
      </section>

      <section className={`mt-media${request.video ? " has-video" : ""}`} aria-label="Photo and clip">
        {request.photo ? (
          <a className="mt-photo" href={request.photo.url} target="_blank" rel="noreferrer" aria-label="Open the photo full size">
            {/* Short-lived signed URL; only ever issued to a party to the request. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={request.photo.url} alt={`Photo of the problem: ${request.category_display}`} />
          </a>
        ) : (
          <span className="mt-photo is-missing"><Icon name="photos" /></span>
        )}
        {request.video ? (
          <ClipPlayer
            url={request.video.url}
            startMs={request.video_clip_start_ms}
            endMs={request.video_clip_end_ms}
          />
        ) : null}
      </section>

      <ol className="mt-track" aria-label="Progress">
        {maintenanceStops(request).map((stop) => (
          <li key={stop.key} data-state={stop.state}>
            <span className="mt-track-mark" aria-hidden="true">{stop.state === "done" ? <Icon name="check" /> : null}</span>
            <strong>{stop.label}</strong>
            {stop.at && stop.state === "done" ? <small>{onDate(stop.at)}</small> : stop.state === "now" ? <small>Now</small> : null}
          </li>
        ))}
      </ol>

      <blockquote className="rq-message mt-description">
        <small>{side === "tenant" ? "What you reported" : `${request.tenant.name} reported`}</small>
        {request.description}
      </blockquote>

      {request.events.length > 1 ? (
        <section className="mt-history" aria-label="History">
          <header><strong>History</strong></header>
          <ol>
            {[...request.events].reverse().map((event) => <HistoryLine key={event.id} event={event} />)}
          </ol>
        </section>
      ) : null}

      {error ? <Notice tone="error" title={error} /> : null}

      {writing ? (
        <section className={`mt-write${writing === "reopen" ? " is-reopen" : ""}`}>
          <label htmlFor="mt-words">
            {writing === "reopen" ? "What is still wrong?" : "What was done? (optional)"}
          </label>
          <textarea
            id="mt-words"
            className="lw-textarea"
            rows={3}
            maxLength={500}
            autoFocus
            value={words}
            placeholder={writing === "reopen" ? "It still drips when the tap is closed." : "Replaced the washer and sealed the joint."}
            onChange={(event) => setWords(event.target.value)}
          />
        </section>
      ) : null}

      <Foot
        can={can}
        writing={writing}
        busy={busy}
        words={words}
        onWrite={(next) => { setWriting(next); setWords(""); setError(""); }}
        onMove={(kind) => void move(kind)}
      />
    </div>
  );
}

/** At most two buttons: the move, and — while writing — the way back. */
function Foot({
  can,
  writing,
  busy,
  words,
  onWrite,
  onMove,
}: {
  can: NonNullable<MaintenanceRequest["permissions"]>;
  writing: "fixed" | "reopen" | null;
  busy: boolean;
  words: string;
  onWrite: (next: "fixed" | "reopen" | null) => void;
  onMove: (kind: "start" | "fixed" | "confirm" | "reopen") => void;
}) {
  if (writing) {
    return (
      <div className="rq-actions">
        <Button
          variant={writing === "reopen" ? "destructive" : "primary"}
          busy={busy}
          disabled={writing === "reopen" && !words.trim()}
          onClick={() => onMove(writing)}
        >
          {writing === "reopen" ? "Reopen request" : <><Icon name="check" />Send to tenant</>}
        </Button>
        <Button variant="quiet" disabled={busy} onClick={() => onWrite(null)}>Back</Button>
      </div>
    );
  }
  if (can.start) {
    return <div className="rq-actions"><Button busy={busy} onClick={() => onMove("start")}><Icon name="wrench" />Start work</Button></div>;
  }
  if (can.report_fixed) {
    return <div className="rq-actions"><Button onClick={() => onWrite("fixed")}><Icon name="check" />Mark as fixed</Button></div>;
  }
  if (can.confirm || can.reopen) {
    return (
      <div className="rq-actions">
        {can.confirm ? <Button busy={busy} onClick={() => onMove("confirm")}><Icon name="check" />Yes, it’s fixed</Button> : null}
        {can.reopen ? <Button variant="quiet" disabled={busy} onClick={() => onWrite("reopen")}>Not fixed</Button> : null}
      </div>
    );
  }
  return null;
}

function HistoryLine({ event }: { event: MaintenanceEvent }) {
  return (
    <li data-kind={event.kind}>
      <span className="mt-history-dot" aria-hidden="true" />
      <span className="mt-history-copy">
        <strong>{event.kind_display}</strong>
        <small>{[event.actor_name, onDate(event.at)].filter(Boolean).join(" · ")}</small>
        {event.note ? <q>{event.note}</q> : null}
      </span>
    </li>
  );
}

/**
 * The clip, and only the clip. A file the device cut is the clip already; one
 * that carries a window (picked on Android) plays from its start and stops at
 * its end, looping back the way a five-second clip would.
 */
export function ClipPlayer({ url, startMs, endMs }: { url: string; startMs: number | null; endMs: number | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const windowed = startMs !== null && endMs !== null;
  return (
    <video
      ref={ref}
      className="mt-clip"
      src={url || undefined}
      controls
      playsInline
      preload="metadata"
      onLoadedMetadata={() => { if (windowed && ref.current) ref.current.currentTime = startMs! / 1000; }}
      onTimeUpdate={() => {
        const video = ref.current;
        if (!video || !windowed) return;
        if (video.currentTime >= endMs! / 1000 || video.currentTime < startMs! / 1000 - 0.25) {
          video.pause();
          video.currentTime = startMs! / 1000;
        }
      }}
      aria-label="Clip of the problem"
    />
  );
}

function heroLine(request: MaintenanceRequest, side: Side) {
  switch (request.status) {
    case "submitted":
      return side === "tenant" ? `Sent ${onDate(request.created_at)}. Waiting for your landlord to start.` : `Reported ${onDate(request.created_at)}. Start the work when someone is on it.`;
    case "reopened":
      return side === "tenant" ? "You said it is not fixed. Your landlord has been told." : "The tenant says it is not fixed. Start the work again.";
    case "in_progress":
      return side === "tenant" ? "Your landlord is working on it." : "Mark it fixed when the work is done; the tenant confirms.";
    case "awaiting_tenant_confirmation":
      return side === "tenant" ? "Your landlord says it is fixed. Is it?" : "Waiting for the tenant to confirm the fix.";
    default:
      return request.completed_at ? `Confirmed fixed ${onDate(request.completed_at)}.` : "Confirmed fixed.";
  }
}

function toneIcon(tone: ReturnType<typeof maintenanceTone>): IconName {
  return { waiting: "clock", working: "wrench", asking: "info", done: "check", reopened: "warning" }[tone] as IconName;
}
