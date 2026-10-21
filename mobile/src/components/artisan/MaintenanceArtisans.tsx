import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import {
  INVITATION_STATE_LABEL,
  PAYMENT_TIP,
  TRADE_FOR_CATEGORY,
  approveQuote,
  declineQuote,
  type ArtisanBrief,
  type ArtisanWork,
  type QuoteView,
} from "@/artisan";
import { ProblemReport, WorkFinish } from "@/components/artisan/WorkFinish";
import { GroupLabel, Pill, RecordPanel } from "@/components/record/RecordSurfaces";
import { Notice, Type, space } from "@/components/ui";
import type { MaintenanceRequest } from "@/maintenance";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * The artisan part of a maintenance request. Mirrors web's `MaintenanceArtisans`.
 *
 * The request stays the record: this reads `request.artisans` and keeps no
 * status of its own. What it offers comes from the backend's `permissions` —
 * anyone who runs the property invites, only the payer approves a price, and
 * the tenant may suggest an artisan and never sees what the work costs.
 *
 * Approving commits the owner's money, so it asks once more before it goes.
 */

const AMBER = theme.color.harmattan["600"];
const AMBER_WASH = theme.color.harmattan["100"];
const KOLA = theme.color.kola["800"];
const KOLA_WASH = theme.color.kola["50"];
const MUTED = theme.color.ink["500"];
const DEEP = theme.color.kola["900"];

export function MaintenanceArtisans({
  request,
  side,
  onChanged,
}: {
  request: MaintenanceRequest;
  side: "tenant" | "provider";
  onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const work = request.artisans;
  if (!work) return null;
  if (!work.assigned && !work.invitations.length && !work.permissions.invite && !work.permissions.suggest && !work.work) return null;

  function find(mode: "invite" | "suggest") {
    router.push({
      pathname: "/(app)/artisans",
      params: {
        request: request.id,
        mode,
        label: request.category_display,
        trade: TRADE_FOR_CATEGORY[request.category] ?? "",
      },
    } as never);
  }

  return <WorkArtisans work={work} side={side} onChanged={onChanged} onFind={find} />;
}

/**
 * Who was asked, what they quoted, who is doing the work: the same section on
 * a repair and on a posted job. What it offers comes from `work.permissions`.
 */
export function WorkArtisans({
  work,
  side,
  onChanged,
  onFind,
  directJobId,
}: {
  work: ArtisanWork;
  side: "tenant" | "provider";
  onChanged: () => Promise<void>;
  onFind: (mode: "invite" | "suggest") => void;
  /** Set on a posted job: its poster confirms or reopens the finished work here. */
  directJobId?: string;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function decide(quote: QuoteView, approve: boolean) {
    setBusy(quote.id);
    setError("");
    try {
      if (approve) await approveQuote(quote.id);
      else await declineQuote(quote.id);
      setConfirming(null);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not go through. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const pendingRevision = work.invitations
    .flatMap((row) => row.quotes)
    .find((quote) => quote.revises && quote.status === "submitted");
  const waiting = work.invitations.filter((row) => row.state !== "assigned" && row.state !== "completed");

  return (
    <View style={{ gap: space[2] }}>
      <GroupLabel>Artisan</GroupLabel>
      {error ? <Notice tone="error" title={error} /> : null}

      {work.assigned ? (
        <RecordPanel style={styles.assigned}>
          <Brief artisan={work.assigned.artisan} />
          <View style={styles.facts}>
            <Chip text={work.work?.finished ? "Did the work" : "Doing the work"} ink={KOLA} wash={KOLA_WASH} />
            {work.assigned.price_on_record ? (
              <Type variant="caption" style={{ color: MUTED }}>
                Price on record <Type variant="captionStrong">{work.assigned.price_on_record.price_display}</Type>
              </Type>
            ) : null}
          </View>
          {pendingRevision && side === "provider" ? (
            <QuoteCard
              quote={pendingRevision}
              title={`Revised price: ${pendingRevision.price_display}`}
              canDecide={work.permissions.approve}
              confirming={confirming === pendingRevision.id}
              busy={busy === pendingRevision.id}
              onAsk={() => setConfirming(pendingRevision.id)}
              onCancel={() => setConfirming(null)}
              onDecide={(approve) => void decide(pendingRevision, approve)}
            />
          ) : null}
        </RecordPanel>
      ) : null}

      {waiting.map((row) => {
        const quote = row.quotes.find((item) => item.status === "submitted" && !item.revises) ?? row.quotes[row.quotes.length - 1];
        return (
          <RecordPanel key={row.id} style={styles.row}>
            <Brief artisan={row.artisan} />
            <View style={styles.facts}>
              <Chip
                text={INVITATION_STATE_LABEL[row.state]}
                ink={row.state === "quoted" ? theme.color.lagoon["600"] : row.state === "invited" || row.state === "suggested" ? AMBER : MUTED}
                wash={row.state === "quoted" ? theme.color.lagoon["100"] : row.state === "invited" || row.state === "suggested" ? AMBER_WASH : theme.color.field["100"]}
              />
            </View>
            {quote && side === "provider" ? (
              <QuoteCard
                quote={quote}
                title={`${quote.price_display}${quote.status === "submitted" ? "" : ` · ${quote.status_display}`}`}
                canDecide={work.permissions.approve && quote.status === "submitted" && !work.assigned}
                confirming={confirming === quote.id}
                busy={busy === quote.id}
                onAsk={() => setConfirming(quote.id)}
                onCancel={() => setConfirming(null)}
                onDecide={(approve) => void decide(quote, approve)}
              />
            ) : null}
          </RecordPanel>
        );
      })}

      {work.permissions.invite ? (
        <Pill
          tone="quiet"
          icon="hammer-outline"
          label={work.invitations.some((row) => row.state !== "suggested") ? "Invite another artisan" : "Find an artisan"}
          onPress={() => onFind("invite")}
        />
      ) : work.permissions.suggest ? (
        <Pill tone="quiet" icon="hammer-outline" label="Suggest an artisan" onPress={() => onFind("suggest")} />
      ) : null}

      {work.work ? (
        <WorkFinish
          work={work.work}
          priceOnRecord={work.assigned?.price_on_record?.price_display}
          directJobId={directJobId}
          canConfirm={Boolean(work.permissions.confirm)}
          onChanged={onChanged}
        />
      ) : null}
      {work.permissions.report && work.work?.invitation_id ? (
        <ProblemReport target={{ kind: "job", invitationId: work.work.invitation_id }} />
      ) : null}

      {side === "provider" && !work.permissions.approve && work.invitations.some((row) => row.quotes.some((quote) => quote.status === "submitted")) ? (
        <Type variant="caption" style={{ color: MUTED }}>
          Only the owner, a Portfolio owner or administrator, or the Property Manager assigned to this property can approve a price.
        </Type>
      ) : null}
    </View>
  );
}

export function Brief({ artisan }: { artisan: ArtisanBrief }) {
  return (
    <View style={styles.brief}>
      <View style={styles.face}>
        {artisan.cover_url ? <Image source={{ uri: artisan.cover_url }} style={StyleSheet.absoluteFill} /> : <Ionicons name="hammer" size={18} color={AMBER} />}
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Type variant="bodyStrong" numberOfLines={1}>{artisan.name}</Type>
        <Type variant="caption" numberOfLines={1} style={{ color: MUTED }}>{artisan.trades.map((trade) => trade.label).join(" · ")}</Type>
      </View>
    </View>
  );
}

export function Chip({ text, ink, wash }: { text: string; ink: string; wash: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: wash }]}>
      <Type variant="captionStrong" style={{ color: ink, fontSize: 12 }}>{text}</Type>
    </View>
  );
}

export function QuoteCard({
  quote,
  title,
  canDecide,
  confirming,
  busy,
  onAsk,
  onCancel,
  onDecide,
}: {
  quote: QuoteView;
  title: string;
  canDecide: boolean;
  confirming: boolean;
  busy: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onDecide: (approve: boolean) => void;
}) {
  return (
    <View style={styles.quote}>
      <Type variant="bodyStrong">{title}</Type>
      {quote.reason ? <Type variant="caption" style={{ color: AMBER }}>{quote.reason}</Type> : null}
      <Type variant="caption" style={{ color: theme.color.ink["700"] }}>{quote.scope}</Type>
      {quote.materials.map((row, index) => (
        <Type key={`${row.item}-${index}`} variant="caption" style={{ color: MUTED }}>
          {row.item}{row.quantity ? ` × ${row.quantity}` : ""}
          {row.cost_minor != null ? ` · GH₵${(row.cost_minor / 100).toLocaleString("en-GH", { minimumFractionDigits: 2 })}` : ""}
        </Type>
      ))}
      {quote.decision_note ? <Type variant="caption" style={{ color: AMBER }}>{quote.decision_note}</Type> : null}
      {canDecide ? (
        <>
          <View style={styles.tip}>
            <Type variant="caption" style={{ color: theme.color.ink["700"] }}>{PAYMENT_TIP}</Type>
          </View>
          {confirming ? (
            <View style={styles.acts}>
              <Pill label={`Approve ${quote.price_display}`} busy={busy} busyLabel="Approving…" onPress={() => onDecide(true)} />
              <Pill tone="quiet" label="Not yet" onPress={onCancel} />
            </View>
          ) : (
            <View style={styles.acts}>
              <Pill label="Approve" onPress={onAsk} />
              <Pill tone="quiet" label="Decline" busy={busy} busyLabel="Declining…" onPress={() => onDecide(false)} />
            </View>
          )}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  assigned: { gap: space[3], padding: space[4], borderColor: alpha(theme.color.kola["600"], 0.2), backgroundColor: KOLA_WASH },
  row: { gap: space[3], padding: space[4] },
  brief: { flexDirection: "row", alignItems: "center", gap: space[3] },
  face: { width: 40, height: 40, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: AMBER_WASH },
  facts: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] },
  chip: { paddingVertical: 2, paddingHorizontal: space[2], borderRadius: 999 },
  quote: { gap: 4, padding: space[3], borderRadius: 14, borderWidth: 1, borderColor: alpha(DEEP, 0.08), backgroundColor: theme.color.field["0"] },
  tip: { marginTop: space[1], paddingVertical: 6, paddingHorizontal: space[3], borderRadius: 10, backgroundColor: theme.color.gold["50"] },
  acts: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[1] },
});
