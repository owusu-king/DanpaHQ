import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Notice, Surface, Type, space } from "@/components/ui";
import {
  listMyArchive,
  restoreProperty,
  restoreSpace,
  type ArchivedProperty,
  type ArchivedSpace,
  type ArchiveSummary,
} from "@/provider";

export default function ArchiveScreen() {
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

  useFocusEffect(useCallback(() => { void load(); }, [load]));

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
    <ScrollView contentContainerStyle={{ padding: space[5], gap: space[4] }}>
      <View style={{ gap: space[2] }}>
        <Type variant="label">ACCOUNT & SETTINGS</Type>
        <Type variant="display2">Archive</Type>
        <Type variant="body">
          Archived inventory keeps its history. Restore is available only when the current lifecycle is valid.
        </Type>
      </View>

      {message ? <Notice tone="success" title={message} /> : null}
      {error ? <Notice tone="error" title={error} /> : null}
      {archive === null ? <Type variant="caption">Loading archive…</Type> : null}
      {empty ? <Notice tone="info" title="Your archive is empty" body="Archived properties and spaces will remain available here." /> : null}

      {archive?.properties.length ? (
        <View style={{ gap: space[3] }}>
          <Type variant="title2">Properties</Type>
          {archive.properties.map((property) => (
            <ArchiveCard
              key={property.id}
              title={property.label}
              kind="PROPERTY"
              meta={`${property.property_type_label} · ${property.locality}, ${property.district}`}
              detail={`${property.unit_count} spaces${property.bed_count ? ` · ${property.bed_count} beds` : ""}`}
              archivedAt={property.archived_at}
              reason={property.archived_reason}
              decision={property.restore}
              busy={busy === property.id}
              onRestore={() => restore(property)}
            />
          ))}
        </View>
      ) : null}

      {archive?.spaces.length ? (
        <View style={{ gap: space[3] }}>
          <Type variant="title2">Spaces</Type>
          {archive.spaces.map((unit) => (
            <ArchiveCard
              key={unit.id}
              title={unit.label}
              kind="SPACE"
              meta={`${unit.property_title} · ${unit.space_type_label}`}
              detail={`${unit.bed_count} beds${unit.property_archived ? " · parent property archived" : ""}`}
              archivedAt={unit.archived_at}
              reason={unit.archived_reason}
              decision={unit.restore}
              busy={busy === unit.id}
              onRestore={() => restore(unit)}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function ArchiveCard({
  title,
  kind,
  meta,
  detail,
  archivedAt,
  reason,
  decision,
  busy,
  onRestore,
}: {
  title: string;
  kind: string;
  meta: string;
  detail: string;
  archivedAt: string;
  reason: string;
  decision: ArchivedProperty["restore"];
  busy: boolean;
  onRestore: () => void;
}) {
  return (
    <Surface style={{ gap: space[2] }}>
      <Type variant="label">{kind}</Type>
      <Type variant="title2">{title}</Type>
      <Type variant="caption">{meta}</Type>
      <Type variant="caption">{detail}</Type>
      <Type variant="caption">Archived {formatDate(archivedAt)}</Type>
      <Type variant="body">{reason || "No reason was recorded for this older archive entry."}</Type>
      {decision.allowed ? (
        <Button label="Restore" busy={busy} busyLabel="Restoring…" onPress={onRestore} />
      ) : (
        <Notice
          tone="warning"
          title="Cannot restore yet"
          body={[decision.message, ...decision.blockers.map((blocker) => blocker.message)].join(" ")}
        />
      )}
    </Surface>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}
