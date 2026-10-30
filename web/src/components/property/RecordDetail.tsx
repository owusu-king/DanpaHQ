"use client";

import { useState, type ReactNode } from "react";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { EntityPath } from "./WorkspacePatterns";

/** Shared composition for provider Property and Unit records. */
export function RecordHeader({ title, context, path, status }: {
  title: string; context: string; path: ReactNode; status: ReactNode;
}) {
  return <header className="record-header">
    {path}
    <div className="record-heading"><h1>{title}</h1><div className="record-statuses">{status}</div></div>
    {context ? <p className="record-context">{context}</p> : null}
  </header>;
}

export { EntityPath as RecordPath };
export type RecordPhoto = { id: string; url: string; label: string };

export function RecordHero({ photos, title, children }: { photos: RecordPhoto[]; title: string; children: ReactNode }) {
  const [selected, setSelected] = useState(0);
  const [viewing, setViewing] = useState(false);
  const selectedIndex = selected < photos.length ? selected : 0;
  const photo = photos[selectedIndex];
  return <div className="record-hero">
    <figure className="record-media">
      {photo ? <button className="record-image-button" type="button" onClick={() => setViewing(true)} aria-label={`View photo of ${title}`}>
        {/* Signed runtime URLs must not pass through the Next image loader. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt={photo.label} />
        <span className="record-image-count">{photos.length > 1 ? `${selectedIndex + 1} / ${photos.length}` : "View photo"}</span>
      </button> : <div className="record-media-empty">No photo on file</div>}
      {photos.length > 1 ? <div className="record-thumbnails" aria-label="Record photos">{photos.map((row, index) => <button key={row.id} type="button" aria-label={`Show photo ${index + 1}`} aria-pressed={index === selectedIndex} onClick={() => setSelected(index)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={row.url} alt="" />
      </button>)}</div> : null}
    </figure>
    <aside className="record-primary" aria-label="Record actions">{children}</aside>
    <ModalSheet open={viewing} onClose={() => setViewing(false)} title={title} icon="photos" size="md">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {photo ? <img className="record-expanded-image" src={photo.url} alt={photo.label} /> : null}
    </ModalSheet>
  </div>;
}

export function RecordSection({ title, actions, children, className = "" }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`record-section ${className}`} aria-label={title}>
    <div className="record-section-head"><h2>{title}</h2>{actions ? <div className="record-section-actions">{actions}</div> : null}</div>
    {children}
  </section>;
}
