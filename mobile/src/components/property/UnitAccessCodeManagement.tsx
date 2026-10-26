import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { ActivityIndicator, Pressable, Share, StyleSheet, View } from "react-native";

import { issuedNotice, privateAccess, type AccessCodeLike } from "@/accessCodeMeaning";
import { ApiFailure } from "@/api";
import { Fact, Footnote, GroupLabel, Pill, QuietAct, RecordPanel } from "@/components/record/RecordSurfaces";
import { Notice, Type, radius, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";
import { revokeUnitAccessCode, rotateUnitAccessCode } from "@/provider";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * One Unit's private share code, wherever the provider is standing.
 *
 * Concise on purpose: what state the code is in, and the one or two things to
 * do about it. Whether the section belongs on screen at all is
 * `privateAccess`'s decision rather than this component's, so the Unit screen
 * and the Tenants tab — and the web — all agree about the same Unit.
 *
 * Two layouts, one behaviour. On the Unit screen it is a section under its own
 * title. In the Tenants tab (2026-09-15) it sits in a card that already names the
 * Unit, beside other Units' cards: no second title, the state in one line with its
 * whole meaning still spoken, and the same acts as small pills — so three Units'
 * buttons do not outweigh what they say.
 *
 * The readable value exists only in this component's state after it is issued.
 * It is never reconstructed from the Unit response and never stored.
 */
export function UnitAccessCodeManagement({
  unitId,
  accessCode,
  verified,
  occupied,
  onChanged,
  layout = "section",
}: {
  unitId: string;
  accessCode: AccessCodeLike;
  verified: boolean;
  occupied: boolean;
  onChanged: () => Promise<void>;
  layout?: "section" | "card";
}) {
  const [issued, setIssued] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // Which act is running, not merely that one is. A single boolean made every
  // control spin when any one of them was pressed, so revoking a code looked
  // as though it were rotating it at the same time.
  const [running, setRunning] = useState<"rotate" | "revoke" | null>(null);
  const busy = running !== null;

  const view = privateAccess(accessCode, { verified, occupied });
  if (!view.show) return null;

  async function rotate() {
    setRunning("rotate");
    setError("");
    setIssued("");
    try {
      const next = await rotateUnitAccessCode(unitId);
      setIssued(next.code);
      setMessage("Any previous code stopped working immediately.");
      try {
        await onChanged();
      } catch {
        setMessage("The code was created, but its status could not refresh. Share it now.");
      }
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not create a code.");
    } finally {
      setRunning(null);
    }
  }

  async function revoke() {
    setRunning("revoke");
    setError("");
    try {
      await revokeUnitAccessCode(unitId);
      setIssued("");
      setMessage("The code was revoked and can no longer be used.");
      try {
        await onChanged();
      } catch {
        setMessage("The code was revoked, but its status could not refresh.");
      }
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not revoke the code.");
    } finally {
      setRunning(null);
    }
  }

  function share() {
    void Share.share({ message: `Danpa HQ space access code: ${issued}` });
  }

  const notice = issuedNotice(accessCode);

  if (layout === "card") {
    const expires = accessCode.state === "active" && accessCode.expires_at ? onDay(accessCode.expires_at) : "";
    return (
      <View style={styles.card}>
        {issued ? (
          <>
            <Notice tone="success" title={notice.title} body={notice.body} />
            <View style={styles.codeWell}>
              <Type variant="mono" selectable style={styles.code}>{issued}</Type>
            </View>
          </>
        ) : (
          <View accessible accessibilityLabel={`${view.headline}. ${view.detail}`} style={styles.state}>
            <View style={[styles.dot, { backgroundColor: dotColor(accessCode.state) }]} />
            <Type variant="bodyStrong" style={styles.headline}>{view.headline}</Type>
            {expires ? <Type variant="caption" style={styles.when}>· Expires {expires}</Type> : null}
            {view.tone === "blocked" ? <Type variant="caption" style={styles.blocked}>{view.detail}</Type> : null}
          </View>
        )}

        {error ? <Notice tone="error" title={error} /> : null}
        {message ? <Type variant="caption" style={styles.when}>{message}</Type> : null}

        {issued || view.primary || view.canRevoke ? (
          <View style={styles.acts}>
            {issued ? <CardAct label="Share code" icon="share-outline" tone="strong" disabled={busy} onPress={share} /> : null}
            {view.primary ? (
              <CardAct label={view.primary} icon="refresh" tone="soft" busy={running === "rotate"} disabled={busy} onPress={() => void rotate()} />
            ) : null}
            {view.canRevoke ? (
              <CardAct label="Revoke" tone="quiet" busy={running === "revoke"} disabled={busy} onPress={() => void revoke()} />
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <GroupLabel>Private access</GroupLabel>

      {issued ? (
        <>
          <Notice tone="success" title={notice.title} body={notice.body} />
          <View style={styles.codeWell}>
            <Type variant="mono" selectable style={styles.code}>{issued}</Type>
          </View>
        </>
      ) : (
        <RecordPanel>
          <Fact
            wide
            first
            label={view.headline}
            value={view.detail}
            tone={view.tone === "blocked" ? "quiet" : "good"}
          />
        </RecordPanel>
      )}

      {error ? <Notice tone="error" title={error} /> : null}
      {message ? <Footnote>{message}</Footnote> : null}

      {/* One act at a time shows it is working. They used to share a single
          flag, so revoking a code spun the rotate control beside it too. */}
      {issued || view.primary || view.canRevoke ? (
        <View style={styles.sectionActs}>
          {issued ? <Pill label="Share code" icon="share-outline" disabled={busy} onPress={share} /> : null}
          {view.primary ? (
            <Pill
              label={view.primary}
              icon="refresh"
              tone={issued ? "quiet" : "primary"}
              busy={running === "rotate"}
              busyLabel="Working"
              disabled={busy}
              onPress={() => void rotate()}
            />
          ) : null}
          {view.canRevoke ? (
            <QuietAct
              label="Revoke"
              icon="close-circle-outline"
              busy={running === "revoke"}
              busyLabel="Revoking"
              disabled={busy}
              onPress={() => void revoke()}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** A card's act: a small pill, so the acts sit under the state rather than over it. */
function CardAct({
  label,
  icon,
  tone,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone: "strong" | "soft" | "quiet";
  /** This act is the one running — it alone spins. */
  busy?: boolean;
  /** Something is running, which may be one of the others. */
  disabled?: boolean;
  onPress: () => void;
}) {
  const ink = tone === "strong" ? theme.color.field["0"] : tone === "soft" ? theme.color.kola["800"] : theme.color.laterite["600"];
  const inert = Boolean(busy || disabled);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-busy={Boolean(busy)} aria-disabled={inert}
      disabled={inert}
      hitSlop={4}
      onPress={onPress}
      {...pressableFeedback(tone === "strong" ? alpha(theme.color.field["0"], 0.2) : theme.color.kola["50"])}
      style={({ pressed }) => [
        styles.act,
        tone === "strong" ? styles.actStrong : tone === "soft" ? styles.actSoft : styles.actQuiet,
        pressed ? { opacity: 0.8 } : null,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={ink} /> : icon ? <Ionicons name={icon} size={15} color={ink} /> : null}
      <Type variant="captionStrong" style={{ fontSize: 14, lineHeight: 18, color: ink }}>{label}</Type>
    </Pressable>
  );
}

/** The state's colour: live in kola, lapsed in harmattan, blocked in laterite, none quiet. */
function dotColor(state: AccessCodeLike["state"]) {
  if (state === "active") return theme.color.kola["600"];
  if (state === "expired" || state === "revoked") return theme.color.harmattan["600"];
  if (state === "unavailable") return theme.color.laterite["600"];
  return alpha(theme.color.ink["900"], 0.28);
}

function onDay(value: string) {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

const styles = StyleSheet.create({
  section: {
    gap: space[2],
    paddingTop: space[2],
  },
  sectionActs: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[3],
    paddingTop: space[1],
  },
  card: {
    gap: space[3],
  },
  state: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space[2],
    rowGap: 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headline: {
    fontSize: 15,
    lineHeight: 20,
    color: theme.color.ink["900"],
  },
  when: {
    fontSize: 13,
    lineHeight: 18,
    color: alpha(theme.color.ink["900"], 0.7),
  },
  blocked: {
    flexBasis: "100%",
    fontSize: 13,
    lineHeight: 18,
    color: alpha(theme.color.ink["900"], 0.7),
  },
  codeWell: {
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: alpha(theme.color.kola["600"], 0.2),
    backgroundColor: theme.color.kola["50"],
  },
  code: {
    fontSize: 20,
    letterSpacing: 2,
    color: theme.color.kola["900"],
  },
  acts: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[2],
  },
  act: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
  },
  actStrong: {
    backgroundColor: theme.color.kola["600"],
  },
  actSoft: {
    borderWidth: 1,
    borderColor: alpha(theme.color.kola["600"], 0.24),
    backgroundColor: theme.color.kola["50"],
  },
  actQuiet: {
    paddingHorizontal: space[3],
  },
});
