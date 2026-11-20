"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Icon } from "@/components/portal/icons";
import type { WalkthroughVideo } from "@/lib/propertyVideo";
import { VideoPlayer } from "./WalkthroughVideo";

export type GalleryPhoto = { id: string; url: string; label: string; sourceLabel?: string };
type GalleryItem =
  | (GalleryPhoto & { kind: "photo" })
  | { id: string; kind: "video"; url: string; label: string; video: WalkthroughVideo };

export function MediaGallery({ photos, empty, videos, title, tools, layout = "record" }: {
  photos: GalleryPhoto[];
  empty: ReactNode;
  videos: { label: string; video?: WalkthroughVideo | null }[];
  layout?: "record" | "listing";
  title?: string;
  tools?: ReactNode;
}) {
  const [selected, setSelected] = useState(0);
  const [viewing, setViewing] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const images: GalleryItem[] = photos.filter((photo) => photo.url).map((photo) => ({
    ...photo, id: `photo-${photo.id}`, kind: "photo",
  }));
  const clips: GalleryItem[] = videos.flatMap(({ label, video }) => video?.url
    ? [{ id: `video-${video.id}`, kind: "video" as const, url: video.url, label, video }]
    : []);
  const media = [...images, ...clips];
  const preview = [...images.slice(0, Math.max(1, 5 - clips.length)), ...clips];
  const index = selected < media.length ? selected : 0;
  const active = media[index];
  const open = viewing && Boolean(active);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    dialogRef.current
      ?.querySelector<HTMLElement>('.detail-media-thumbnails [aria-pressed="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index, open]);

  function move(by: number) {
    setSelected((index + by + media.length) % media.length);
  }

  if (!active) return (
    <section className="detail-media-gallery" aria-label="Property media">
      {empty}
      {tools ? <div className="listing-discovery-tools">{tools}</div> : null}
    </section>
  );

  function thumbnail(item: GalleryItem) {
    return item.kind === "photo" ? (
      // Signed runtime URLs must bypass the Next image loader.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={item.url} alt="" loading="lazy" decoding="async" />
    ) : (
      <>
        <video src={item.url} muted playsInline preload="metadata" aria-hidden="true" />
        <span className="detail-media-play" aria-hidden="true">▶</span>
      </>
    );
  }

  const thumbnails = media.length > 1 ? (
    <div className="detail-media-thumbnails" aria-label="All property media">
      {media.map((item, position) => (
        <button
          key={item.id}
          type="button"
          aria-label={`Show ${item.label}, ${item.kind === "video" ? "video" : "photo"} ${position + 1} of ${media.length}`}
          aria-pressed={position === index}
          onClick={() => setSelected(position)}
        >
          {thumbnail(item)}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <section className="detail-media-gallery" data-layout={layout} aria-label="Property media">
      {layout === "listing" ? (
        <div className="detail-media-grid" data-count={preview.length}>
          {preview.map((item) => (
            <button
              key={item.id}
              type="button"
              className="detail-media-tile"
              aria-label={`Open ${item.label}, ${item.kind === "video" ? "video" : "photo"}`}
              onClick={() => { setSelected(media.indexOf(item)); setViewing(true); }}
            >
              {thumbnail(item)}
              {item.kind === "video" ? <span className="detail-media-label">{item.label}</span> : null}
            </button>
          ))}
        </div>
      ) : <div className="detail-media-stage">
        {!viewing && active.kind === "video" ? (
          <VideoPlayer key={active.id} video={active.video} label={active.label} />
        ) : active.kind === "photo" ? (
          <button type="button" className="detail-media-image" aria-label={`Expand ${active.label}`} onClick={() => setViewing(true)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={active.url} alt={active.label} />
          </button>
        ) : null}
        <button type="button" className="detail-media-count" aria-label={`Expand property media, ${index + 1} of ${media.length}`} onClick={() => setViewing(true)}>
          {index + 1} / {media.length}
        </button>
      </div>}
      {layout === "listing" ? (
        <div className="listing-discovery-tools">
          {tools}
          <button type="button" className="detail-media-all" onClick={() => { setSelected(0); setViewing(true); }}>
            <Icon name="photos" />View property media ({media.length})
          </button>
        </div>
      ) : thumbnails}
      <dialog
        ref={dialogRef}
        className="detail-media-lightbox"
        aria-label={title ? `Property media · ${title}` : "Property media"}
        onClose={() => setViewing(false)}
        onCancel={(event) => { event.preventDefault(); setViewing(false); }}
        onClick={(event) => { if (event.target === event.currentTarget) setViewing(false); }}
      >
        {open && active ? (
          <div className="detail-media-viewer" onKeyDown={(event) => {
            if (event.target instanceof HTMLVideoElement) return;
            if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
            if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
          }}>
            <div className="detail-media-expanded">
              {active.kind === "video" ? <VideoPlayer key={active.id} video={active.video} label={active.label} expanded /> : (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={active.id} src={active.url} alt={active.label} />
              )}
              {media.length > 1 ? (
                <>
                  <button type="button" className="detail-media-step is-prev" aria-label="Previous media" onClick={() => move(-1)}><ChevronLeft aria-hidden="true" /></button>
                  <button type="button" className="detail-media-step is-next" aria-label="Next media" onClick={() => move(1)}><ChevronRight aria-hidden="true" /></button>
                </>
              ) : null}
            </div>
            <div className="detail-media-navigation">
              <span aria-live="polite">
                {active.kind === "photo" ? active.sourceLabel || active.label : active.label} · {index + 1} of {media.length}
              </span>
              <button type="button" className="detail-media-close" aria-label="Close property media" autoFocus onClick={() => setViewing(false)}><X aria-hidden="true" /></button>
            </div>
            {thumbnails}
          </div>
        ) : null}
      </dialog>
    </section>
  );
}
