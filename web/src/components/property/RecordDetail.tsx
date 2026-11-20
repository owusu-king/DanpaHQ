"use client";

import type { ReactNode } from "react";
import type { WalkthroughVideo } from "@/lib/propertyVideo";
import { MediaGallery } from "./MediaGallery";
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

export function RecordHero({ photos, title, video, videoLabel = "Video", children }: {
  photos: RecordPhoto[]; title: string; video?: WalkthroughVideo | null; videoLabel?: string; children: ReactNode;
}) {
  return <div className="record-hero">
    <MediaGallery title={title} photos={photos} videos={[{ label: videoLabel, video }]}
      empty={<div className="record-media-empty">No property media on file</div>} />
    <aside className="record-primary" aria-label="Record actions">{children}</aside>
  </div>;
}

export function RecordSection({ title, actions, children, className = "" }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`record-section ${className}`} aria-label={title}>
    <div className="record-section-head"><h2>{title}</h2>{actions ? <div className="record-section-actions">{actions}</div> : null}</div>
    {children}
  </section>;
}
