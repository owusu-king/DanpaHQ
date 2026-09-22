import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Bone } from "@/components/billing/BillingParts";
import { EntityHeader, StatusLine, type StatusTone } from "@/components/property/WorkspacePatterns";
import {
  ActionBar,
  EDGE,
  Fact,
  Footnote,
  GroupLabel,
  INK,
  Lead,
  LinkRow,
  MUTED,
  Pill,
  QuietAct,
  RecordPanel,
} from "@/components/record/RecordSurfaces";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Field, Notice, Type, space } from "@/components/ui";
import { cancelLease, endLease, getLease, leaseAction, offerLease, type Lease } from "@/leases";
import { formatMinor } from "@/listings";
import { printLeaseDocument, shareLeaseDocument } from "@/leaseDocuments";
import { useSafeBottom } from "@/platform";
import { providerLeaseStatus, providerLeaseTone } from "@/providerLeaseMeaning";
import { theme } from "@/theme";

/**
 * One agreement, from the side that drafted it.
 *
 * The tenant's record asks "should I sign this"; this one asks "where has it
 * got to, and what do I do with it". So the one act the status is waiting on
 * sits in the bar, and the irreversible ones — discarding a draft, withdrawing
 * an offer, ending a tenancy — wait behind "More", each confirmed with a reason
 * before it happens.
 *
 * Refined on review (2026-09-21) onto the record surfaces: paper panels on the
 * warm ground, replacing a wrapped grid of label/value pairs and a column of
 * stacked buttons whose destructive members sat one tap from the primary.
 */
export default function ProviderLeaseScreen() {
  const router = useRouter();
  const { leaseId } = useLocalSearchParams<{ leaseId?: string }>();
  const [lease, setLease] = useState<Lease | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exits, setExits] = useState(false);
  const [confirmation, setConfirmation] = useState<"cancel" | "end" | null>(null);
  const [reason, setReason] = useState("");
  const openBottom = useSafeBottom(space[8]);

  const load = useCallback(async () => {
    if (!leaseId) {
      setError("This agreement could not be found.");
      return;
    }
    try {
      setLease(await getLease(leaseId));
      setError("");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "We could not load this agreement.",
      );
    }
  }, [leaseId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function act(action: "offer" | "confirm" | "cancel" | "end") {
    if (!lease) return;
    setBusy(true);
    setError("");
    try {
      if (action === "offer") await offerLease(lease.id);
      else if (action === "confirm") await leaseAction(lease.id, "confirm");
      else if (action === "cancel") await cancelLease(lease.id, reason.trim());
      else await endLease(lease.id, reason.trim(), true);
      setConfirmation(null);
      setReason("");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That action did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function documentAction(kind: "share" | "print") {
    if (!lease) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "share") await shareLeaseDocument(lease);
      else await printLeaseDocument(lease);
    } catch (cause) {
      setError(
        cause instanceof ApiFailure
          ? cause.error.message
          : cause instanceof Error
            ? cause.message
            : "The document could not be opened.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!lease) {
    return (
      <View style={{ padding: space[5] }}>
        {error ? <Notice tone="error" title={error} /> : <LeaseSkeleton />}
      </View>
    );
  }

  const terms = lease.agreement?.terms;
  const money = terms?.money;
  const term = terms?.term;
  const tenant = terms?.parties.tenant.name ?? lease.tenant_name;
  const property = terms?.property.title ?? lease.property_title;
  const unit = terms?.space.unit_label ?? lease.unit_label;
  const bed = terms?.space.bed_label ?? lease.bed_label;
  const conditions = terms?.conditions ?? lease.conditions;
  const rendered = lease.agreement?.rendered_document;
  const primary = primaryAct(lease);
  const closing = lease.status === "draft" || lease.status === "ready" || lease.status === "offered" || lease.status === "active";
  const focused = confirmation !== null;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.page, { paddingBottom: focused || !(primary || closing) ? openBottom : space[6] }]}>
        <EntityHeader
          eyebrow="Agreement"
          title={tenant}
          subtitle={[property, unit, bed].filter(Boolean).join(" · ")}
          status={<StatusLine label={statusLabel(lease)} tone={statusTone(lease)} />}
        />

        {error ? <Notice tone="error" title={error} /> : null}

        {lease.advance_notice ? (
          <Notice
            tone="warning"
            title={`${lease.advance_notice.months} months' advance`}
            body={lease.advance_notice.message}
          />
        ) : null}

        {focused ? (
          <View style={styles.section}>
            <GroupLabel>
              {confirmation === "end"
                ? "End this tenancy?"
                : lease.status === "draft"
                  ? "Discard this draft?"
                  : "Withdraw this offer?"}
            </GroupLabel>
            <RecordPanel style={styles.formPanel}>
              <Type variant="caption" style={styles.formNote}>
                {confirmation === "end"
                  ? "This ends the active occupancy. The Unit stays private until you deliberately publish it again."
                  : "The tenant will no longer be able to accept this agreement."}
              </Type>
              <Field
                label="Reason (optional)"
                value={reason}
                onChangeText={setReason}
                maxLength={300}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                style={{ minHeight: 72 }}
              />
              <Pill
                grow
                tone="danger"
                label={
                  confirmation === "end"
                    ? "Confirm end tenancy"
                    : lease.status === "draft"
                      ? "Discard draft"
                      : "Withdraw offer"
                }
                busy={busy}
                busyLabel="Working…"
                onPress={() => void act(confirmation)}
              />
              <QuietAct
                label="Go back"
                disabled={busy}
                onPress={() => { setConfirmation(null); setReason(""); }}
              />
            </RecordPanel>
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <GroupLabel>What it costs</GroupLabel>
              <RecordPanel>
                <Lead
                  label="Move-in total"
                  value={money ? formatMinor(money.move_in_total_minor, money.rent_currency) : (lease.move_in_total_formatted ?? "Not recorded")}
                />
                <View style={styles.rule} />
                <Fact
                  first
                  label="Rent"
                  value={`${money ? formatMinor(money.rent_minor, money.rent_currency) : (lease.rent_formatted ?? "Not recorded")} per ${(money?.rent_period ?? lease.rent_period) === "yearly" ? "year" : "month"}`}
                />
                <Fact label="Advance" value={`${money?.advance_months ?? lease.advance_months} months`} />
                <Fact label="Deposit" value={`${money?.deposit_months ?? lease.deposit_months} months`} />
              </RecordPanel>
            </View>

            <View style={styles.section}>
              <GroupLabel>For how long</GroupLabel>
              <RecordPanel>
                <Fact first label="Starts" value={formatDate(term?.starts_on ?? lease.starts_on)} />
                <Fact
                  label="Ends"
                  value={
                    (term?.ends_on ?? lease.ends_on)
                      ? formatDate((term?.ends_on ?? lease.ends_on)!)
                      : `${term?.term_months ?? lease.term_months} months`
                  }
                />
              </RecordPanel>
            </View>

            {conditions ? (
              <View style={styles.section}>
                <GroupLabel>Conditions</GroupLabel>
                <RecordPanel>
                  <Fact wide first label="Agreed conditions" value={conditions} />
                </RecordPanel>
              </View>
            ) : null}

            {rendered?.sections?.length ? (
              <View style={styles.section}>
                <GroupLabel>Complete agreement</GroupLabel>
                <RecordPanel style={styles.document}>
                  <View style={styles.documentHead}>
                    <Type variant="label" style={styles.reference}>{lease.agreement?.reference_number}</Type>
                    <Type variant="bodyStrong" style={styles.documentTitle}>{rendered.title}</Type>
                    <Type variant="caption" style={styles.template}>Template {lease.agreement?.template.version}</Type>
                  </View>
                  {rendered.production_notice ? (
                    <Notice tone="warning" title="Pre-production legal review" body={rendered.production_notice} />
                  ) : null}
                  {rendered.sections.map((section) => (
                    <View key={section.id} style={styles.clause}>
                      <Type variant="bodyStrong" style={styles.clauseTitle}>{section.title}</Type>
                      <Type variant="body" selectable style={styles.clauseBody}>{section.body}</Type>
                    </View>
                  ))}
                </RecordPanel>
              </View>
            ) : null}

            <View style={styles.section}>
              <GroupLabel>The record</GroupLabel>
              <RecordPanel>
                <Fact
                  first
                  label={tenant}
                  value={lease.tenant_accepted_at ? `accepted ${formatDate(lease.tenant_accepted_at)}` : "not yet"}
                  tone={lease.tenant_accepted_at ? "good" : "waiting"}
                />
                <Fact
                  label="You"
                  value={lease.landlord_accepted_at ? `accepted ${formatDate(lease.landlord_accepted_at)}` : "not yet"}
                  tone={lease.landlord_accepted_at ? "good" : "waiting"}
                />
                {lease.agreement ? <Fact wide label="Content hash" value={lease.agreement.content_hash} /> : null}
              </RecordPanel>
              {lease.agreement ? (
                <Footnote>
                  {lease.agreement.reference_number ? `${lease.agreement.reference_number} · ` : ""}
                  Template {lease.agreement.template.version || lease.agreement.schema_version} ·{" "}
                  {lease.agreement.accepted_by.length} acceptance record
                  {lease.agreement.accepted_by.length === 1 ? "" : "s"}
                </Footnote>
              ) : (
                <Notice
                  tone="warning"
                  title="Older agreement"
                  body="This agreement predates frozen agreement records. The original lease fields are shown."
                />
              )}
              {lease.agreement?.final_pdf_url ? (
                <View style={styles.documentRow}>
                  <QuietAct icon="document-outline" label="View or save PDF" disabled={busy} onPress={() => void documentAction("share")} />
                  <QuietAct icon="print-outline" label="Print" disabled={busy} onPress={() => void documentAction("print")} />
                </View>
              ) : null}
            </View>

            {lease.decline_reason ? (
              <View style={styles.section}>
                <GroupLabel>Recorded reason</GroupLabel>
                <RecordPanel>
                  <Fact wide first label="Why" value={lease.decline_reason} />
                </RecordPanel>
              </View>
            ) : null}

            <RecordPanel>
              <LinkRow
                first
                icon="cube-outline"
                label="Open Unit"
                onPress={() => router.push({ pathname: "/(app)/space", params: { unitId: terms?.space.unit_id ?? lease.unit } } as never)}
              />
              {lease.status === "ended" ? (
                <LinkRow
                  icon="cash-outline"
                  label="Closing financial account"
                  detail="What is still owed, and what was written off."
                  onPress={() => router.push({
                    pathname: "/(app)/rent-account",
                    params: { leaseId: lease.id, tenantName: tenant, propertyTitle: property, unitLabel: unit, bedLabel: bed ?? "" },
                  } as never)}
                />
              ) : null}
            </RecordPanel>
          </>
        )}
      </ScrollView>

      {!focused && (primary || closing) ? (
        <ActionBar>
          {primary ? (
            <Pill
              grow
              icon={primary.icon}
              label={primary.label}
              busy={busy}
              busyLabel="Working…"
              onPress={() => void act(primary.action)}
            />
          ) : null}
          {closing ? (
            <View style={primary ? null : styles.soleAct}>
              <QuietAct icon="ellipsis-horizontal" label="More" onPress={() => setExits(true)} />
            </View>
          ) : null}
        </ActionBar>
      ) : null}

      <BottomSheet visible={exits} onClose={() => setExits(false)} title="More" closeLabel="Close options">
        <View style={styles.sheetBody}>
          <RecordPanel>
            {lease.status === "draft" || lease.status === "ready" ? (
              <LinkRow
                first
                icon="trash-outline"
                tone="alert"
                label="Discard draft"
                detail="Nothing is sent, and the draft is gone."
                onPress={() => { setExits(false); setConfirmation("cancel"); }}
              />
            ) : null}
            {lease.status === "offered" ? (
              <LinkRow
                first
                icon="close-circle-outline"
                tone="alert"
                label="Withdraw offer"
                detail="The tenant can no longer accept it."
                onPress={() => { setExits(false); setConfirmation("cancel"); }}
              />
            ) : null}
            {lease.status === "active" ? (
              <LinkRow
                first
                icon="exit-outline"
                tone="alert"
                label="End tenancy"
                detail="Ends the occupancy. The Unit stays private until you publish it again."
                onPress={() => { setExits(false); setConfirmation("end"); }}
              />
            ) : null}
          </RecordPanel>
        </View>
      </BottomSheet>
    </View>
  );
}

/** The one act the status is waiting on, if there is one. */
function primaryAct(lease: Lease): { action: "offer" | "confirm"; label: string; icon: "send-outline" | "checkmark-done-outline" } | null {
  if (lease.status === "draft" || lease.status === "ready") {
    return { action: "offer", label: "Send agreement", icon: "send-outline" };
  }
  if (lease.status === "tenant_accepted") {
    return { action: "confirm", label: "Confirm and activate", icon: "checkmark-done-outline" };
  }
  return null;
}

/** Shaped like the terms it becomes, so nothing jumps when the agreement arrives. */
function LeaseSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading this agreement" style={{ gap: space[4] }}>
      <Bone width="42%" height={13} />
      <Bone width="70%" height={22} />
      <RecordPanel style={styles.formPanel}>
        <Bone width="36%" height={12} />
        <Bone width="54%" height={30} />
        <Bone height={44} />
      </RecordPanel>
    </View>
  );
}

// The words and colours the Leases list uses too, from one place.
function statusLabel(lease: Lease) {
  return providerLeaseStatus(lease);
}
function statusTone(lease: Lease): StatusTone {
  const tone = providerLeaseTone(lease);
  return tone === "good" ? "good" : tone === "attention" ? "attention" : tone === "waiting" ? "waiting" : "neutral";
}
function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  page: {
    padding: space[4],
    gap: space[4],
  },
  section: {
    gap: space[2],
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: space[4],
    backgroundColor: EDGE,
  },
  formPanel: {
    gap: space[3],
    padding: space[4],
  },
  formNote: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  document: {
    gap: space[4],
    padding: space[4],
  },
  documentHead: {
    gap: 2,
    alignItems: "center",
  },
  reference: {
    color: MUTED,
  },
  documentTitle: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
    color: INK,
  },
  template: {
    fontSize: 12,
    lineHeight: 16,
    color: MUTED,
  },
  clause: {
    gap: space[1],
    paddingTop: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: EDGE,
  },
  clauseTitle: {
    fontSize: 14.5,
    lineHeight: 20,
    color: INK,
  },
  clauseBody: {
    fontSize: 14.5,
    lineHeight: 24,
    color: theme.color.ink["700"],
  },
  documentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[4],
    paddingHorizontal: 2,
  },
  soleAct: {
    flex: 1,
    alignItems: "center",
  },
  sheetBody: {
    gap: space[3],
  },
});
