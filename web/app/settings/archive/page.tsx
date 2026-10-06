"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { useToast } from "@/components/toast/Toaster";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure } from "@/lib/api";
import {
  listMyArchive,
  restoreProperty,
  restoreSpace,
  type ArchivedProperty,
  type ArchivedSpace,
  type ArchiveSummary,
} from "@/lib/console";

type Archived = ArchivedProperty | ArchivedSpace;

/**
 * Archive: what was put away, and the way back.
 *
 * One card, a row per Property or space. Restoring is confirmed in a small
 * sheet that says what comes back; a record the server will not restore yet
 * says why on its own row, so nobody presses a button to find out.
 */
export default function ArchivePage() {
  const { toast } = useToast();
  const [archive, setArchive] = useState<ArchiveSummary | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<Archived | null>(null);

  const load = useCallback(async () => {
    try {
      setArchive(await listMyArchive());
      setError("");
    } catch (cause) {
      setArchive({ properties: [], spaces: [] });
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your archive.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function restore(resource: Archived) {
    setBusy(resource.id);
    setError("");
    try {
      if (resource.resource_type === "property") await restoreProperty(resource.id);
      else await restoreSpace(resource.id);
      toast({ tone: "success", title: `${resource.label} restored`, description: "It is back in your working portfolio." });
      await load();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That resource could not be restored.");
      await load();
    } finally {
      setBusy("");
    }
  }

  const count = archive ? archive.properties.length + archive.spaces.length : 0;
  const empty = archive !== null && count === 0;

  return (
    <>
      <SettingsCard
        title="Archive"
        description="Properties and spaces you put away. Restoring brings them back into your working portfolio."
        action={archive && count ? <span className="prefs-count"><strong>{count}</strong> archived</span> : null}
      >
        {error ? <Notice tone="error" title={error} /> : null}
        {archive === null ? (
          <div className="prefs-skeleton" aria-busy="true" aria-label="Loading your archive">
            {Array.from({ length: 3 }).map((_, index) => <span key={index} className="ws-skeleton-block" />)}
          </div>
        ) : null}

        {empty ? (
          <div className="archive-empty">
            <span className="archive-empty-mark" aria-hidden="true"><Icon name="archive" /></span>
            <strong>Your archive is empty</strong>
            <span>Properties and spaces you archive stay here, out of the working portfolio.</span>
            <Link href="/properties" className="ws-action">Back to Properties</Link>
          </div>
        ) : null}

        {archive?.properties.length ? (
          <ArchiveGroup title="Properties" count={archive.properties.length}>
            {archive.properties.map((property) => (
              <ArchiveRow
                key={property.id}
                icon="properties"
                resource={property}
                meta={`${property.property_type_label} · ${property.locality}, ${property.district}`}
                inventory={`${property.unit_count} ${property.unit_count === 1 ? "space" : "spaces"}${property.bed_count ? ` · ${property.bed_count} beds` : ""}`}
                busy={busy === property.id}
                onRestore={() => setConfirming(property)}
              />
            ))}
          </ArchiveGroup>
        ) : null}

        {archive?.spaces.length ? (
          <ArchiveGroup title="Spaces" count={archive.spaces.length}>
            {archive.spaces.map((space) => (
              <ArchiveRow
                key={space.id}
                icon="units"
                resource={space}
                meta={`${space.property_title} · ${space.space_type_label}`}
                inventory={`${space.bed_count} ${space.bed_count === 1 ? "bed" : "beds"}${space.property_archived ? " · parent property archived" : ""}`}
                busy={busy === space.id}
                onRestore={() => setConfirming(space)}
              />
            ))}
          </ArchiveGroup>
        ) : null}
      </SettingsCard>

      <ModalSheet
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        icon="archive"
        size="sm"
        title={confirming ? `Restore ${confirming.label}?` : "Restore"}
        meta={confirming?.resource_type === "property" ? "Property" : "Space"}
        footer={(close) => (
          <>
            <button type="button" className="ws-action" onClick={close}>Cancel</button>
            <button
              type="button"
              className="ws-action is-primary"
              onClick={() => {
                const target = confirming;
                close();
                if (target) void restore(target);
              }}
            >Restore</button>
          </>
        )}
      >
        <p className="sheet-copy">
          It returns to your working portfolio as it was when you archived it. Its history, agreements and records are unchanged.
        </p>
      </ModalSheet>
    </>
  );
}

function ArchiveGroup({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="archive-group">
      <p className="archive-group-title">{title}<span>{count}</span></p>
      <ul className="archive-rows">{children}</ul>
    </div>
  );
}

function ArchiveRow({
  icon,
  resource,
  meta,
  inventory,
  busy,
  onRestore,
}: {
  icon: "properties" | "units";
  resource: Archived;
  meta: string;
  inventory: string;
  busy: boolean;
  onRestore: () => void;
}) {
  const decision = resource.restore;
  return (
    <li className={`archive-row${decision.allowed ? "" : " is-blocked"}`}>
      <span className="archive-row-mark" aria-hidden="true"><Icon name={icon} /></span>
      <span className="archive-row-text">
        <strong>{resource.label}</strong>
        <small>{meta} · {inventory}</small>
        <span className="archive-row-reason">{resource.archived_reason || "No reason was recorded for this older archive entry."}</span>
        {decision.allowed ? null : (
          <span className="archive-row-blocked" role="note">
            <b>Cannot restore yet.</b> {[decision.message, ...decision.blockers.map((blocker) => blocker.message)].join(" ")}
          </span>
        )}
      </span>
      <span className="archive-row-side">
        <time dateTime={resource.archived_at}>Archived {formatDate(resource.archived_at)}</time>
        {decision.allowed ? (
          <button type="button" className="ws-action" aria-haspopup="dialog" disabled={busy} onClick={onRestore}>
            {busy ? "Restoring…" : "Restore"}
          </button>
        ) : null}
      </span>
    </li>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}
