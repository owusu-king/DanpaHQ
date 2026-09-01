import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, Switch, View } from "react-native";

import { agreedTerms, homeOf, money, months, per, standing } from "@/agreementMeaning";
import { ApiFailure } from "@/api";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { acceptLease, declineLease, leaseAction, listMyLeases, type Lease } from "@/leases";
import { printLeaseDocument, shareLeaseDocument } from "@/leaseDocuments";
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
 * conditions, then who is party to it, then the record — and only then the two
 * buttons.
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
  if (!lease) {
    return (
      <View style={{ padding: space[5] }}>
        <Type variant="caption">Loading…</Type>
      </View>
    );
  }

  const terms = agreedTerms(lease);
  const state = standing(lease);
  const rendered = lease.agreement?.rendered_document?.sections?.length
    ? lease.agreement.rendered_document
    : null;

  return (
    <ScrollView
      contentContainerStyle={{ padding: space[5], gap: space[5], paddingBottom: space[10] }}
    >
      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor:
                state.stage === "action"
                  ? theme.color.kola["600"]
                  : state.stage === "active"
                    ? theme.color.kola["300"]
                    : theme.color.ink["300"],
            }}
          />
          <Type
            variant="bodyStrong"
            style={{
              fontSize: 14,
              color: state.decisionOpen ? theme.color.kola["600"] : theme.color.ink["700"],
            }}
          >
            {state.line}
          </Type>
        </View>
        <Type variant="display2" accessibilityRole="header">
          {homeOf(terms)}
        </Type>
        <Type variant="caption">
          With {terms.landlordName}
          {terms.address
            ? ` · ${terms.address}`
            : lease.locality_name
              ? ` · ${lease.locality_name}`
              : ""}
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

      <Block title="What it costs">
        <Type variant="title1">
          {money(terms.moveInTotalMinor, terms.rentCurrency)}
          <Type variant="caption"> to move in</Type>
        </Type>
        <Fact
          label="Rent"
          value={`${money(terms.rentMinor, terms.rentCurrency)} per ${per(terms.rentPeriod)}`}
        />
        <Fact label="Advance" value={months(terms.advanceMonths)} />
        <Fact label="Deposit" value={terms.depositMonths ? months(terms.depositMonths) : "None"} />
        <Fact
          label="Agency fee"
          value={terms.agencyFeeMonths ? months(terms.agencyFeeMonths) : "None"}
        />
        <Type variant="caption" style={{ marginTop: space[1] }}>
          Nothing is paid through Rooomly. This records what was agreed.
        </Type>
      </Block>

      <Block title="For how long">
        <Fact label="Starts" value={terms.startsOn ? longDate(terms.startsOn) : "Not set"} />
        <Fact label="Term" value={months(terms.termMonths)} />
        <Fact label="Ends" value={terms.endsOn ? longDate(terms.endsOn) : "Not set"} />
      </Block>

      {!rendered ? (
        <Block title="Conditions">
          <Type variant="body">
            {terms.conditions || "No additional conditions were recorded."}
          </Type>
        </Block>
      ) : null}

      {!rendered ? (
        <Block title="Between">
          <Fact label="Landlord" value={terms.landlordName} />
          <Fact label="Tenant" value={terms.tenantName} />
        </Block>
      ) : null}

      {rendered ? (
        <Block title="Complete agreement">
          <View style={{ gap: space[5] }}>
            <View style={{ gap: space[1], alignItems: "center" }}>
              <Type variant="label">{rendered.reference_number}</Type>
              <Type variant="title1" style={{ textAlign: "center" }}>
                {rendered.title}
              </Type>
              <Type variant="caption">Template {rendered.template.version}</Type>
            </View>
            {rendered.production_notice ? (
              <Notice
                tone="warning"
                title="Pre-production legal review"
                body={rendered.production_notice}
              />
            ) : null}
            {rendered.sections.map((section) => (
              <View
                key={section.key}
                style={{
                  gap: space[2],
                  paddingTop: space[4],
                  borderTopWidth: 1,
                  borderTopColor: theme.color.field["200"],
                }}
              >
                <Type variant="bodyStrong">{section.title}</Type>
                <Type variant="body" selectable style={{ lineHeight: 26 }}>
                  {section.body}
                </Type>
              </View>
            ))}
          </View>
        </Block>
      ) : null}

      {/* Who pressed accept and when. The serializer has carried this all along
          and neither client showed it. */}
      {lease.agreement ? (
        <Block title="The record">
          {lease.agreement.accepted_by.length ? (
            lease.agreement.accepted_by.map((acceptance) => (
              <Type key={`${acceptance.party}-${acceptance.accepted_at}`} variant="body">
                <Type variant="bodyStrong">{acceptance.name}</Type>
                {` accepted on ${longDate(acceptance.accepted_at)}`}
              </Type>
            ))
          ) : (
            <Type variant="caption">Nobody has accepted this yet.</Type>
          )}
          <Type variant="mono">{lease.agreement.content_hash.slice(0, 16)}…</Type>
          <Type variant="caption">
            {lease.agreement.reference_number ? `${lease.agreement.reference_number}. ` : ""}
            Template {lease.agreement.template.version || lease.agreement.schema_version}. This
            identifies the exact terms above. It is not an electronic signature.
          </Type>
          {lease.agreement.final_pdf_url ? <DocumentActions lease={lease} /> : null}
        </Block>
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
    <View style={{ gap: space[2], marginTop: space[2] }}>
      {error ? <Notice tone="error" title={error} /> : null}
      <Button
        label="View or save PDF"
        variant="secondary"
        busy={busy === "share"}
        busyLabel="Opening…"
        disabled={busy !== null}
        onPress={() => void run("share")}
      />
      <Button
        label="Print"
        variant="quiet"
        busy={busy === "print"}
        busyLabel="Opening printer…"
        disabled={busy !== null}
        onPress={() => void run("print")}
      />
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
    <View
      style={{
        gap: space[3],
        padding: space[4],
        backgroundColor: theme.color.field["50"],
        borderWidth: 1,
        borderColor: theme.color.field["200"],
        borderRadius: 12,
      }}
    >
      <Type variant="label" accessibilityRole="header">
        YOUR DECISION
      </Type>
      {error ? <Notice tone="error" title={error} /> : null}

      {step === "choose" ? (
        <>
          <Button label="Accept agreement" onPress={() => setStep("accept")} />
          <Button label="Decline" variant="quiet" onPress={() => setStep("decline")} />
        </>
      ) : step === "accept" ? (
        <>
          <Type variant="bodyStrong">
            You are accepting {money(terms.moveInTotalMinor, terms.rentCurrency)} to move in and{" "}
            {money(terms.rentMinor, terms.rentCurrency)} per {per(terms.rentPeriod)} for{" "}
            {months(terms.termMonths)} from{" "}
            {terms.startsOn ? longDate(terms.startsOn) : "the agreed date"}.
          </Type>
          <Type variant="caption">
            You cannot undo this yourself, and the terms cannot be changed afterwards — a different
            arrangement means a new agreement.
          </Type>
          {mustAcknowledge ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
              <Switch
                value={acknowledged}
                onValueChange={setAcknowledged}
                trackColor={{ false: theme.color.field["300"], true: theme.color.kola["300"] }}
                thumbColor={acknowledged ? theme.color.kola["600"] : theme.color.field["0"]}
                accessibilityLabel="I have read the advance-rent notice"
              />
              <Type variant="body" style={{ flex: 1 }}>
                I have read the advance-rent notice at the top of this screen.
              </Type>
            </View>
          ) : null}
          <Button
            label="Yes, accept it"
            busy={busy}
            busyLabel="Accepting…"
            disabled={mustAcknowledge && !acknowledged}
            onPress={() => run(() => acceptLease(lease.id, acknowledged))}
          />
          <Button
            label="Go back"
            variant="quiet"
            disabled={busy}
            onPress={() => setStep("choose")}
          />
        </>
      ) : (
        <>
          <Type variant="bodyStrong">
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
          <Button
            label="Yes, decline it"
            variant="destructive"
            busy={busy}
            busyLabel="Declining…"
            onPress={() => run(() => declineLease(lease.id, reason.trim()))}
          />
          <Button
            label="Go back"
            variant="quiet"
            disabled={busy}
            onPress={() => setStep("choose")}
          />
        </>
      )}
    </View>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        gap: space[2],
        paddingTop: space[4],
        borderTopWidth: 1,
        borderTopColor: theme.color.field["200"],
      }}
    >
      <Type variant="label" accessibilityRole="header">
        {title.toUpperCase()}
      </Type>
      {children}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        minHeight: 36,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space[4],
      }}
    >
      <Type variant="caption">{label}</Type>
      <Type variant="bodyStrong" style={{ flexShrink: 1, textAlign: "right" }}>
        {value}
      </Type>
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
