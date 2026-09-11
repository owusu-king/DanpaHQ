import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Field, Notice, Surface, Type, space } from "@/components/ui";
import { cancelLease, endLease, getLease, leaseAction, offerLease, type Lease } from "@/leases";
import { formatMinor } from "@/listings";
import { printLeaseDocument, shareLeaseDocument } from "@/leaseDocuments";
import { theme } from "@/theme";

export default function ProviderLeaseScreen() {
  const router = useRouter();
  const { leaseId } = useLocalSearchParams<{ leaseId?: string }>();
  const [lease, setLease] = useState<Lease | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<"cancel" | "end" | null>(null);
  const [reason, setReason] = useState("");
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
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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

  if (!lease)
    return (
      <ScrollView contentContainerStyle={{ padding: space[5], gap: space[4] }}>
        {error ? (
          <Notice tone="error" title={error} />
        ) : (
          <Type variant="caption">Loading agreement…</Type>
        )}
        <Button label="Back to Leases" variant="quiet" onPress={() => router.back()} />
      </ScrollView>
    );

  const terms = lease.agreement?.terms;
  const money = terms?.money;
  const term = terms?.term;
  const tenant = terms?.parties.tenant.name ?? lease.tenant_name;
  const property = terms?.property.title ?? lease.property_title;
  const unit = terms?.space.unit_label ?? lease.unit_label;
  const bed = terms?.space.bed_label ?? lease.bed_label;
  const conditions = terms?.conditions ?? lease.conditions;
  return (
    <ScrollView
      contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[5] }}
    >
      <View style={{ gap: space[1] }}>
        <Type variant="label" style={{ color: statusColor(lease) }}>
          {statusLabel(lease).toUpperCase()}
        </Type>
        <Type variant="display2" accessibilityRole="header">
          {tenant}
        </Type>
        <Type variant="body">
          {property}
          {unit ? ` · ${unit}` : ""}
          {bed ? ` · ${bed}` : ""}
        </Type>
        {terms?.property.address ? <Type variant="caption">{terms.property.address}</Type> : null}
      </View>
      {error ? <Notice tone="error" title={error} /> : null}
      {lease.advance_notice ? (
        <Notice
          tone="warning"
          title={`${lease.advance_notice.months} months' advance`}
          body={lease.advance_notice.message}
        />
      ) : null}
      <Surface style={{ gap: space[4] }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[5] }}>
          <Fact
            label="Rent"
            value={
              money
                ? formatMinor(money.rent_minor, money.rent_currency)
                : (lease.rent_formatted ?? "Not recorded")
            }
            detail={`per ${money?.rent_period === "yearly" || lease.rent_period === "yearly" ? "year" : "month"}`}
          />
          <Fact
            label="Move-in total"
            value={
              money
                ? formatMinor(money.move_in_total_minor, money.rent_currency)
                : (lease.move_in_total_formatted ?? "Not recorded")
            }
          />
        </View>
        <View style={{ height: 1, backgroundColor: theme.color.field["200"] }} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[5] }}>
          <Fact label="Starts" value={formatDate(term?.starts_on ?? lease.starts_on)} />
          <Fact
            label="Ends"
            value={
              (term?.ends_on ?? lease.ends_on)
                ? formatDate((term?.ends_on ?? lease.ends_on)!)
                : `${term?.term_months ?? lease.term_months} months`
            }
          />
          <Fact label="Advance" value={`${money?.advance_months ?? lease.advance_months} months`} />
          <Fact label="Deposit" value={`${money?.deposit_months ?? lease.deposit_months} months`} />
        </View>
      </Surface>
      {conditions ? (
        <Section title="Conditions">
          <Type variant="body">{conditions}</Type>
        </Section>
      ) : null}
      {lease.agreement?.rendered_document?.sections?.length ? (
        <Section title="Complete agreement">
          <View style={{ gap: space[5] }}>
            <View style={{ gap: space[1], alignItems: "center" }}>
              <Type variant="label">{lease.agreement.reference_number}</Type>
              <Type variant="title1" style={{ textAlign: "center" }}>
                {lease.agreement.rendered_document.title}
              </Type>
              <Type variant="caption">Template {lease.agreement.template.version}</Type>
            </View>
            {lease.agreement.rendered_document.production_notice ? (
              <Notice
                tone="warning"
                title="Pre-production legal review"
                body={lease.agreement.rendered_document.production_notice}
              />
            ) : null}
            {lease.agreement.rendered_document.sections.map((section) => (
              <View
                key={section.id}
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
        </Section>
      ) : null}
      <Section title="Acceptance">
        <Type variant="caption">
          {lease.tenant_accepted_at
            ? `${tenant} accepted ${formatDate(lease.tenant_accepted_at)}.`
            : `Waiting for ${tenant}.`}{" "}
          {lease.landlord_accepted_at
            ? `Provider accepted ${formatDate(lease.landlord_accepted_at)}.`
            : ""}
        </Type>
      </Section>
      {lease.decline_reason ? (
        <Notice tone="info" title="Recorded reason" body={lease.decline_reason} />
      ) : null}
      {lease.agreement ? (
        <Section title="Agreement record">
          <Type variant="caption">
            {lease.agreement.reference_number ? `${lease.agreement.reference_number} · ` : ""}
            Template {lease.agreement.template.version || lease.agreement.schema_version} ·{" "}
            {lease.agreement.accepted_by.length} acceptance record
            {lease.agreement.accepted_by.length === 1 ? "" : "s"}
          </Type>
          <Type variant="mono" selectable style={{ color: theme.color.ink["500"] }}>
            {lease.agreement.content_hash}
          </Type>
          {lease.agreement.final_pdf_url ? (
            <View style={{ gap: space[2] }}>
              <Button
                label="View or save PDF"
                variant="secondary"
                disabled={busy}
                onPress={() => void documentAction("share")}
              />
              <Button
                label="Print"
                variant="quiet"
                disabled={busy}
                onPress={() => void documentAction("print")}
              />
            </View>
          ) : null}
        </Section>
      ) : (
        <Notice
          tone="warning"
          title="Older agreement"
          body="This agreement predates frozen agreement records. The original lease fields are shown."
        />
      )}
      {confirmation ? (
        <View style={{ gap: space[3] }}>
          <Notice
            tone="warning"
            title={
              confirmation === "end"
                ? "End this tenancy?"
                : lease.status === "draft"
                  ? "Discard this draft?"
                  : "Withdraw this offer?"
            }
            body={
              confirmation === "end"
                ? "This ends the active occupancy. The Unit stays private until you deliberately publish it again."
                : "The tenant will no longer be able to accept this agreement."
            }
          />
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
          <Button
            label={
              confirmation === "end"
                ? "Confirm end tenancy"
                : lease.status === "draft"
                  ? "Discard draft"
                  : "Withdraw offer"
            }
            variant="destructive"
            busy={busy}
            onPress={() => void act(confirmation)}
          />
          <Button
            label="Go back"
            variant="quiet"
            disabled={busy}
            onPress={() => {
              setConfirmation(null);
              setReason("");
            }}
          />
        </View>
      ) : (
        <View style={{ gap: space[2] }}>
          {lease.status === "draft" || lease.status === "ready" ? (
            <>
              <Button
                label="Send agreement"
                busy={busy}
                busyLabel="Sending…"
                onPress={() => void act("offer")}
              />
              <Button
                label="Discard draft"
                variant="destructive"
                disabled={busy}
                onPress={() => setConfirmation("cancel")}
              />
            </>
          ) : null}
          {lease.status === "tenant_accepted" ? (
            <Button
              label="Confirm and activate tenancy"
              busy={busy}
              busyLabel="Confirming…"
              onPress={() => void act("confirm")}
            />
          ) : null}
          {lease.status === "offered" ? (
            <Button
              label="Withdraw offer"
              variant="destructive"
              onPress={() => setConfirmation("cancel")}
            />
          ) : null}
          {lease.status === "active" ? (
            <Button
              label="End tenancy"
              variant="destructive"
              onPress={() => setConfirmation("end")}
            />
          ) : null}
          {lease.status === "ended" ? (
            <Button
              label="Open closing financial account"
              variant="secondary"
              onPress={() => router.push({
                pathname: "/(app)/rent-account",
                params: {
                  leaseId: lease.id,
                  tenantName: tenant,
                  propertyTitle: property,
                  unitLabel: unit,
                  bedLabel: bed ?? "",
                },
              } as never)}
            />
          ) : null}
        </View>
      )}
      <Section title="Related record">
        <Button
          label="Open Unit"
          variant="quiet"
          onPress={() =>
            router.push({
              pathname: "/(app)/space",
              params: { unitId: terms?.space.unit_id ?? lease.unit },
            } as never)
          }
        />
      </Section>
    </ScrollView>
  );
}

function Fact({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <View style={{ minWidth: 128, flex: 1, gap: space[1] }}>
      <Type variant="label">{label.toUpperCase()}</Type>
      <Type variant="bodyStrong">{value}</Type>
      {detail ? <Type variant="caption">{detail}</Type> : null}
    </View>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        gap: space[2],
        paddingTop: space[4],
        borderTopWidth: 1,
        borderTopColor: theme.color.field["200"],
      }}
    >
      <Type variant="title2" accessibilityRole="header">
        {title}
      </Type>
      {children}
    </View>
  );
}
function statusLabel(lease: Lease) {
  return (
    {
      draft: "Draft",
      ready: "Ready to send",
      offered: "Waiting for tenant",
      tenant_accepted: "Confirmation needed",
      awaiting_activation: "Awaiting activation",
      active: "Active tenancy",
      declined: "Declined",
      cancelled: "Withdrawn",
      ended: "Ended",
    } as Record<Lease["status"], string>
  )[lease.status];
}
function statusColor(lease: Lease) {
  return lease.status === "active"
    ? theme.color.kola["600"]
    : ["draft", "tenant_accepted"].includes(lease.status)
      ? theme.color.laterite["600"]
      : ["ready", "offered", "awaiting_activation"].includes(lease.status)
        ? theme.color.harmattan["600"]
        : theme.color.ink["500"];
}
function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
