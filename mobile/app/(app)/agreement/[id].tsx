import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, ScrollView, Switch, View } from "react-native";

import { agreedTerms, homeOf, money, months, per, standing } from "@/agreementMeaning";
import { ApiFailure } from "@/api";
import { Bone } from "@/components/billing/BillingParts";
import {
  EDGE,
  Fact,
  Footnote,
  GroupLabel,
  INK,
  Lead,
  MUTED,
  Pill,
  QuietAct,
  RecordPanel,
  StandingLine,
  type RecordTone,
} from "@/components/record/RecordSurfaces";
import { Field, Notice, Type, space } from "@/components/ui";
import { acceptLease, declineLease, leaseAction, listMyLeases, type Lease } from "@/leases";
import { printLeaseDocument, shareLeaseDocument } from "@/leaseDocuments";
import { useSafeBottom } from "@/platform";
import { theme } from "@/theme";

/**
 * One agreement, in full, and the decision at the end of it.
 *
 * The record the whole product exists to produce, read from the side with the
 * most to lose. Deliberately not minimal: the money, the dates, the conditions,
 * the statutory advance notice and the acceptance record are all here, in
 * reading order, and none is folded away to save lines. Low reading density is
 * a rule about *unnecessary* words.
 *
 * The order is the argument. Advance notice, then money, then dates, then
 * conditions, then who is party to it, then the record — and only then the
 * decision.
 *
 * Refined on review (2026-09-21) onto the record surfaces. The decision stays at
 * the foot of the reading rather than moving to a bar that follows the page:
 * every other record here answers "what do I do now", and this one answers
 * "should I sign this", which is a question you finish reading before you answer.
 *
 * Read from `/me/leases/`, which returns only agreements where this account is
 * the tenant, so this screen can never offer tenant actions on somebody else's.
 */
export default function AgreementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [lease, setLease] = useState<Lease | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const pageBottom = useSafeBottom(space[8]);

  const load = useCallback(async () => {
    try {
      const mine = await listMyLeases();
      const found = mine.find((row) => row.id === id) ?? null;
      setLease(found);
      setMissing(found === null);
    } catch (cause) {
      setMissing(true);
      setLoadError(
        cause instanceof ApiFailure ? cause.error.message : "We could not open that agreement.",
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (
      lease?.workflow_version === "canonical_v1" &&
      lease.status === "offered" &&
      !lease.tenant_reviewed_at
    ) {
      void leaseAction(lease.id, "review").catch(() => undefined);
    }
  }, [lease?.id, lease?.status, lease?.tenant_reviewed_at, lease?.workflow_version]);

  if (missing) {
    return (
      <View style={{ padding: space[5] }}>
        <Notice tone="error" title={loadError || "We could not find that agreement."} />
      </View>
    );
  }
  if (!lease) return <AgreementSkeleton />;

  const terms = agreedTerms(lease);
  const state = standing(lease);
  const tone: RecordTone = state.decisionOpen ? "action" : state.stage === "active" ? "good" : "quiet";
  const rendered = lease.agreement?.rendered_document?.sections?.length
    ? lease.agreement.rendered_document
    : null;

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]}>
      <View style={styles.identity}>
        <StandingLine line={state.line} tone={tone} />
        <Type variant="title2" accessibilityRole="header" numberOfLines={3} style={styles.home}>
          {homeOf(terms)}
        </Type>
        <Type variant="caption" numberOfLines={2} style={styles.with}>
          With {terms.landlordName}
          {terms.address ? ` · ${terms.address}` : lease.locality_name ? ` · ${lease.locality_name}` : ""}
        </Type>
      </View>

      {/* The thing most likely to change the decision goes first, not last. */}
      {lease.advance_notice ? (
        <Notice
          tone="warning"
          title={`This asks for ${months(lease.advance_notice.months)} rent in advance`}
          body={lease.advance_notice.message}
        />
      ) : null}

      {!terms.frozen ? (
        <Notice
          tone="warning"
          title="This is an older agreement"
          body="Its snapshot predates agreement versioning, so the terms below come from the live record rather than a frozen copy. Check them against what you agreed."
        />
      ) : null}

      <View style={styles.section}>
        <GroupLabel>What it costs</GroupLabel>
        <RecordPanel>
          <Lead label="Move-in total" value={money(terms.moveInTotalMinor, terms.rentCurrency)} />
          <View style={styles.rule} />
          <Fact
            first
            label="Rent"
            value={`${money(terms.rentMinor, terms.rentCurrency)} per ${per(terms.rentPeriod)}`}
          />
          <Fact label="Advance" value={months(terms.advanceMonths)} />
          <Fact label="Deposit" value={terms.depositMonths ? months(terms.depositMonths) : "None"} />
          <Fact label="Agency fee" value={terms.agencyFeeMonths ? months(terms.agencyFeeMonths) : "None"} />
        </RecordPanel>
        <Footnote>Nothing is paid through Rooomly. This records what was agreed.</Footnote>
      </View>

      <View style={styles.section}>
        <GroupLabel>For how long</GroupLabel>
        <RecordPanel>
          <Fact first label="Starts" value={terms.startsOn ? longDate(terms.startsOn) : "Not set"} />
          <Fact label="Term" value={months(terms.termMonths)} />
          <Fact label="Ends" value={terms.endsOn ? longDate(terms.endsOn) : "Not set"} />
        </RecordPanel>
      </View>

      {!rendered ? (
        <View style={styles.section}>
          <GroupLabel>Conditions</GroupLabel>
          <RecordPanel>
            <Fact wide first label="Agreed conditions" value={terms.conditions || "No additional conditions were recorded."} />
          </RecordPanel>
        </View>
      ) : null}

      {!rendered ? (
        <View style={styles.section}>
          <GroupLabel>Between</GroupLabel>
          <RecordPanel>
            <Fact first label="Landlord" value={terms.landlordName} />
            <Fact label="Tenant" value={terms.tenantName} />
          </RecordPanel>
        </View>
      ) : null}

      {rendered ? (
        <View style={styles.section}>
          <GroupLabel>Complete agreement</GroupLabel>
          <RecordPanel style={styles.document}>
            <View style={styles.documentHead}>
              <Type variant="label" style={styles.reference}>{rendered.reference_number}</Type>
              <Type variant="bodyStrong" style={styles.documentTitle}>{rendered.title}</Type>
              <Type variant="caption" style={styles.template}>Template {rendered.template.version}</Type>
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

      {/* Who pressed accept and when. The serializer has carried this all along
          and neither client showed it. */}
      {lease.agreement ? (
        <View style={styles.section}>
          <GroupLabel>The record</GroupLabel>
          <RecordPanel>
            {lease.agreement.accepted_by.length ? (
              lease.agreement.accepted_by.map((acceptance, index) => (
                <Fact
                  key={`${acceptance.party}-${acceptance.accepted_at}`}
                  first={index === 0}
                  label={acceptance.name}
                  value={`accepted on ${longDate(acceptance.accepted_at)}`}
                />
              ))
            ) : (
              <Fact first label="Accepted" value="Nobody yet" />
            )}
            <Fact
              wide
              label="Content hash"
              value={lease.agreement.content_hash}
            />
          </RecordPanel>
          <Footnote>
            {lease.agreement.reference_number ? `${lease.agreement.reference_number}. ` : ""}
            Template {lease.agreement.template.version || lease.agreement.schema_version}. This
            identifies the exact terms above. It is not an electronic signature.
          </Footnote>
          {lease.agreement.final_pdf_url ? <DocumentActions lease={lease} /> : null}
        </View>
      ) : null}

      {state.decisionOpen ? (
        <Decision lease={lease} terms={terms} onDone={() => router.back()} />
      ) : null}
    </ScrollView>
  );
}

function DocumentActions({ lease }: { lease: Lease }) {
  const [busy, setBusy] = useState<"share" | "print" | null>(null);
  const [error, setError] = useState("");
  async function run(kind: "share" | "print") {
    setBusy(kind);
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
      setBusy(null);
    }
  }
  return (
    <View style={styles.documentActions}>
      {error ? <Notice tone="error" title={error} /> : null}
      <View style={styles.documentRow}>
        <QuietAct
          icon="document-outline"
          label="View or save PDF"
          busy={busy === "share"}
          busyLabel="Opening…"
          disabled={busy !== null}
          onPress={() => void run("share")}
        />
        <QuietAct
          icon="print-outline"
          label="Print"
          busy={busy === "print"}
          busyLabel="Opening printer…"
          disabled={busy !== null}
          onPress={() => void run("print")}
        />
      </View>
    </View>
  );
}

/**
 * Accept or decline, after the reading.
 *
 * Two steps, and the second says what actually happens rather than that
 * something important is about to. Acceptance cannot be undone by the tenant,
 * and the terms are never edited afterwards: a different arrangement is a new
 * agreement.
 */
function Decision({
  lease,
  terms,
  onDone,
}: {
  lease: Lease;
  terms: ReturnType<typeof agreedTerms>;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"choose" | "accept" | "decline">("choose");
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const mustAcknowledge = lease.advance_notice?.requires_acknowledgement ?? false;

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not work.");
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <GroupLabel>Your decision</GroupLabel>
      <RecordPanel style={styles.decision}>
        {error ? <Notice tone="error" title={error} /> : null}

        {step === "choose" ? (
          <>
            <Pill grow icon="checkmark-outline" label="Accept agreement" onPress={() => setStep("accept")} />
            <QuietAct label="Decline" onPress={() => setStep("decline")} />
          </>
        ) : step === "accept" ? (
          <>
            <Type variant="bodyStrong" style={styles.decisionLead}>
              You are accepting {money(terms.moveInTotalMinor, terms.rentCurrency)} to move in and{" "}
              {money(terms.rentMinor, terms.rentCurrency)} per {per(terms.rentPeriod)} for{" "}
              {months(terms.termMonths)} from{" "}
              {terms.startsOn ? longDate(terms.startsOn) : "the agreed date"}.
            </Type>
            <Type variant="caption" style={styles.decisionNote}>
              You cannot undo this yourself, and the terms cannot be changed afterwards — a different
              arrangement means a new agreement.
            </Type>
            {mustAcknowledge ? (
              <View style={styles.acknowledge}>
                <Switch
                  value={acknowledged}
                  onValueChange={setAcknowledged}
                  trackColor={{ false: theme.color.field["300"], true: theme.color.kola["300"] }}
                  thumbColor={acknowledged ? theme.color.kola["600"] : theme.color.field["0"]}
                  accessibilityLabel="I have read the advance-rent notice"
                />
                <Type variant="body" style={styles.acknowledgeText}>
                  I have read the advance-rent notice at the top of this screen.
                </Type>
              </View>
            ) : null}
            <Pill
              grow
              label="Yes, accept it"
              busy={busy}
              busyLabel="Accepting…"
              disabled={mustAcknowledge && !acknowledged}
              onPress={() => run(() => acceptLease(lease.id, acknowledged))}
            />
            <QuietAct label="Go back" disabled={busy} onPress={() => setStep("choose")} />
          </>
        ) : (
          <>
            <Type variant="bodyStrong" style={styles.decisionLead}>
              Declining ends this offer. The landlord would have to send a new one.
            </Type>
            <Field
              label="Reason (optional)"
              value={reason}
              onChangeText={setReason}
              multiline
              numberOfLines={3}
              maxLength={300}
              textAlignVertical="top"
              placeholder="Tell the landlord what did not work, if you want to."
              style={{ minHeight: 72 }}
            />
            <Pill
              grow
              tone="danger"
              label="Yes, decline it"
              busy={busy}
              busyLabel="Declining…"
              onPress={() => run(() => declineLease(lease.id, reason.trim()))}
            />
            <QuietAct label="Go back" disabled={busy} onPress={() => setStep("choose")} />
          </>
        )}
      </RecordPanel>
    </View>
  );
}

/** Shaped like the terms it becomes, so nothing jumps when the agreement arrives. */
function AgreementSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading this agreement" style={styles.page}>
      <View style={styles.identity}>
        <Bone width="46%" height={13} />
        <Bone width="82%" height={20} />
        <Bone width="60%" />
      </View>
      <RecordPanel style={styles.skeletonPanel}>
        <Bone width="34%" height={12} />
        <Bone width="52%" height={30} />
        <Bone height={44} />
      </RecordPanel>
      <RecordPanel style={styles.skeletonPanel}>
        <Bone width="40%" height={12} />
        <Bone height={44} />
      </RecordPanel>
    </View>
  );
}

function longDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const styles = StyleSheet.create({
  page: {
    padding: space[4],
    gap: space[4],
  },
  identity: {
    gap: space[2],
    paddingHorizontal: 2,
  },
  home: {
    fontSize: 19,
    lineHeight: 25,
  },
  with: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  section: {
    gap: space[2],
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: space[4],
    backgroundColor: EDGE,
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
  documentActions: {
    gap: space[2],
  },
  documentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[4],
    paddingHorizontal: 2,
  },
  decision: {
    gap: space[3],
    padding: space[4],
  },
  decisionLead: {
    fontSize: 15,
    lineHeight: 21,
    color: INK,
  },
  decisionNote: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  acknowledge: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  acknowledgeText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  skeletonPanel: {
    gap: space[3],
    padding: space[4],
  },
});
