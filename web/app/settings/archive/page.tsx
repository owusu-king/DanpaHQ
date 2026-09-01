"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Empty, LoadingRows, Section } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import {
  listMyArchive,
  restoreProperty,
  restoreSpace,
  type ArchivedProperty,
  type ArchivedSpace,
  type ArchiveSummary,
} from "@/lib/console";

export default function ArchivePage() {
  const [archive, setArchive] = useState<ArchiveSummary | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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

  async function restore(resource: ArchivedProperty | ArchivedSpace) {
    setBusy(resource.id);
    setError("");
    setMessage("");
    try {
      if (resource.resource_type === "property") await restoreProperty(resource.id);
      else await restoreSpace(resource.id);
      setMessage(`${resource.label} was restored to your working portfolio.`);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That resource could not be restored.");
      await load();
    } finally {
      setBusy("");
    }
  }

  const empty = archive !== null && archive.properties.length === 0 && archive.spaces.length === 0;

  return (
    <div>
      <section className="settings-section">
        <h2>Archive</h2>
      </section>

      {message ? <Notice tone="success" title={message} /> : null}
      {error ? <Notice tone="error" title={error} /> : null}
      {archive === null ? <LoadingRows rows={4} /> : null}
      {empty ? (
        <Empty
          title="Your archive is empty"
          body="Properties and spaces you archive will remain available here without appearing in the working portfolio."
          action={<Link href="/properties" className="type-body-strong">Back to properties →</Link>}
        />
      ) : null}

      {archive?.properties.length ? (
        <Section title="Properties">
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            {archive.properties.map((property) => (
              <ArchivedPropertyCard
                key={property.id}
                property={property}
                busy={busy === property.id}
                onRestore={() => restore(property)}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {archive?.spaces.length ? (
        <div style={{ marginTop: "var(--space-8)" }}>
          <Section title="Spaces">
            <div style={{ display: "grid", gap: "var(--space-4)" }}>
              {archive.spaces.map((space) => (
                <ArchivedSpaceCard
                  key={space.id}
                  space={space}
                  busy={busy === space.id}
                  onRestore={() => restore(space)}
                />
              ))}
            </div>
          </Section>
        </div>
      ) : null}
    </div>
  );
}

function ArchivedPropertyCard({
  property,
  busy,
  onRestore,
}: {
  property: ArchivedProperty;
  busy: boolean;
  onRestore: () => void;
}) {
  return (
    <ArchiveCard
      title={property.label}
      kind="Property"
      meta={`${property.property_type_label} · ${property.locality}, ${property.district}`}
      archivedAt={property.archived_at}
      reason={property.archived_reason}
      detail={`${property.unit_count} ${property.unit_count === 1 ? "space" : "spaces"}${property.bed_count ? ` · ${property.bed_count} beds` : ""}`}
      decision={property.restore}
      busy={busy}
      onRestore={onRestore}
    />
  );
}

function ArchivedSpaceCard({
  space,
  busy,
  onRestore,
}: {
  space: ArchivedSpace;
  busy: boolean;
  onRestore: () => void;
}) {
  return (
    <ArchiveCard
      title={space.label}
      kind="Space"
      meta={`${space.property_title} · ${space.space_type_label}`}
      archivedAt={space.archived_at}
      reason={space.archived_reason}
      detail={`${space.bed_count} ${space.bed_count === 1 ? "bed" : "beds"}${space.property_archived ? " · parent property archived" : ""}`}
      decision={space.restore}
      busy={busy}
      onRestore={onRestore}
    />
  );
}

function ArchiveCard({
  title,
  kind,
  meta,
  archivedAt,
  reason,
  detail,
  decision,
  busy,
  onRestore,
}: {
  title: string;
  kind: string;
  meta: string;
  archivedAt: string;
  reason: string;
  detail: string;
  decision: ArchivedProperty["restore"];
  busy: boolean;
  onRestore: () => void;
}) {
  return (
    <article className="portal-panel">
      <div className="portal-panel-lead">
        <div>
          <p className="type-label" style={{ margin: 0, color: "var(--color-ink-500)", textTransform: "uppercase" }}>{kind}</p>
          <h2 className="type-title-2" style={{ margin: "var(--space-1) 0 0" }}>{title}</h2>
          <p className="type-caption" style={{ margin: "var(--space-1) 0 0" }}>{meta}</p>
        </div>
        <span className="type-caption">Archived {formatDate(archivedAt)}</span>
      </div>

      <dl style={{ display: "grid", gap: "var(--space-3)", margin: "var(--space-5) 0" }}>
        <Detail label="Reason" value={reason || "No reason was recorded for this older archive entry."} />
        <Detail label="Inventory" value={detail} />
      </dl>

      {decision.allowed ? (
        <Button busy={busy} busyLabel="Restoring…" onClick={onRestore}>Restore</Button>
      ) : (
        <Notice
          tone="warning"
          title="Cannot restore yet"
          body={[decision.message, ...decision.blockers.map((blocker) => blocker.message)].join(" ")}
        />
      )}
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="type-label" style={{ color: "var(--color-ink-500)", textTransform: "uppercase" }}>{label}</dt>
      <dd className="type-body" style={{ margin: "var(--space-1) 0 0" }}>{value}</dd>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}
