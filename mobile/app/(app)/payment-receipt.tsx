import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Notice, Surface, Type, radius, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import { printPaymentReceipt, sharePaymentReceipt } from "@/paymentDocuments";
import { getPaymentReceipt, paymentMethodLabel, type PaymentReceipt } from "@/payments";
import { theme } from "@/theme";

type DocumentAction = "share" | "print";

export default function PaymentReceiptScreen() {
  const pageBottom = useSafeBottom(space[12]);
  const { receiptId = "" } = useLocalSearchParams<{ receiptId?: string }>();
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [error, setError] = useState("");
  const [documentBusy, setDocumentBusy] = useState<DocumentAction | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPaymentReceipt(receiptId)
      .then((row) => {
        if (!cancelled) setReceipt(row);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof ApiFailure
              ? cause.error.message
              : "We could not load this receipt.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [receiptId]);

  async function openDocument(kind: DocumentAction) {
    if (!receipt) return;
    setDocumentBusy(kind);
    setError("");
    try {
      if (kind === "share") await sharePaymentReceipt(receipt);
      else await printPaymentReceipt(receipt);
    } catch (cause) {
      setError(
        cause instanceof ApiFailure
          ? cause.error.message
          : cause instanceof Error
            ? cause.message
            : "The receipt document could not be opened.",
      );
    } finally {
      setDocumentBusy(null);
    }
  }

  const snapshot = receipt?.snapshot;
  const premises = snapshot?.premises;
  const providerName = snapshot?.provider.organization_name || snapshot?.provider.signer_name;
  const period = snapshot?.obligation.period_start && snapshot.obligation.period_end
    ? `${formatDate(snapshot.obligation.period_start)} – ${formatDate(snapshot.obligation.period_end)}`
    : "Not applicable";

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: space[5], paddingBottom: pageBottom, gap: space[5] }}
    >
      <View style={{ gap: space[1] }}>
        <Type variant="label">PAYMENT RECORD</Type>
        <Type variant="display2" accessibilityRole="header">Payment receipt</Type>
        <Type variant="body">Your confirmed payment record, ready whenever you need it.</Type>
      </View>

      {!receipt && !error ? <Type variant="caption">Loading receipt…</Type> : null}
      {error ? <Notice tone="error" title={error} /> : null}

      {receipt ? (
        <Surface style={{ padding: space[5], gap: space[5] }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space[3],
              paddingBottom: space[4],
              borderBottomWidth: 1,
              borderBottomColor: theme.color.field["200"],
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: theme.color.kola["300"],
                borderRadius: radius.pill,
              }}
            >
              <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>✓</Type>
            </View>
            <View style={{ flex: 1, gap: space[1] }}>
              <Type variant="bodyStrong">{receipt.source === "EXTERNAL" ? "External payment confirmed" : "Payment confirmed"}</Type>
              <Type variant="caption">{formatDateTime(receipt.issued_at)}</Type>
            </View>
          </View>

          <View style={{ gap: space[1] }}>
            <Type variant="display2" style={{ color: theme.color.kola["600"] }}>
              {receipt.amount_formatted}
            </Type>
            <Type variant="mono">{receipt.receipt_number}</Type>
          </View>

          {snapshot && premises ? (
            <>
              <View style={{ gap: space[1], paddingBottom: space[1] }}>
                <Type variant="label">PAYMENT FOR</Type>
                <Type variant="title2">
                  {premises.property_title}
                  {premises.unit_label ? ` · ${premises.unit_label}` : ""}
                  {premises.bed_label ? ` · ${premises.bed_label}` : ""}
                </Type>
                <Type variant="caption">
                  {premises.address.display || premises.address.locality}
                </Type>
              </View>

              <View style={{ borderTopWidth: 1, borderTopColor: theme.color.field["200"] }}>
                <ReceiptFact label="Tenant" value={snapshot.tenant.name} />
                <ReceiptFact label="Received by" value={providerName || "Property provider"} />
                <ReceiptFact label="Payment for" value={snapshot.obligation.kind_label} />
                <ReceiptFact label="Period covered" value={period} />
                <ReceiptFact
                  label="Premises"
                  value={`${premises.space_type_label} · ${premises.is_furnished ? "Furnished" : "Unfurnished"}`}
                />
                <ReceiptFact label="Payment method" value={snapshot.payment.method_label} />
                <ReceiptFact label="Payment source" value={snapshot.payment.source_label} />
                <ReceiptFact label="Evidence" value={snapshot.evidence.label} />
                {snapshot.payment.source === "PLATFORM_PSP" ? <>
                  <ReceiptFact label="Processor" value={titleCase(snapshot.processor.name)} />
                  <ReceiptFact label="Transaction reference" value={snapshot.processor.transaction_id} mono />
                </> : null}
                {snapshot.payment.source === "EXTERNAL" && snapshot.payment.reference ? <ReceiptFact label="External reference" value={snapshot.payment.reference} mono /> : null}
                {snapshot.evidence.filename ? <ReceiptFact label="Attached evidence" value={snapshot.evidence.filename} /> : null}
              </View>
            </>
          ) : (
            <View style={{ borderTopWidth: 1, borderTopColor: theme.color.field["200"] }}>
              <ReceiptFact label="Issued" value={formatDateTime(receipt.issued_at)} />
              <ReceiptFact label="Method" value={paymentMethodLabel(receipt.payment_method)} />
              <ReceiptFact label="Payment source" value={receipt.source === "EXTERNAL" ? "Paid externally and recorded through Danpa HQ" : "Processed through Danpa HQ"} />
              {receipt.source === "PLATFORM_PSP" ? <><ReceiptFact label="Processor" value={titleCase(receipt.provider)} /><ReceiptFact label="Transaction reference" value={receipt.provider_transaction_id} mono /></> : null}
            </View>
          )}

          {receipt.final_document_available ? (
            <View style={{ gap: space[2] }}>
              <Button
                label="View or save PDF"
                variant="secondary"
                busy={documentBusy === "share"}
                busyLabel="Opening…"
                disabled={documentBusy !== null}
                onPress={() => void openDocument("share")}
              />
              <Button
                label="Print"
                variant="quiet"
                busy={documentBusy === "print"}
                busyLabel="Opening printer…"
                disabled={documentBusy !== null}
                onPress={() => void openDocument("print")}
              />
            </View>
          ) : null}

          <Type
            variant="caption"
            style={{
              paddingTop: space[4],
              borderTopWidth: 1,
              borderTopColor: theme.color.field["200"],
            }}
          >
            {snapshot?.stamp.notice || "Keep this receipt with your tenancy records."}
          </Type>
        </Surface>
      ) : null}
    </ScrollView>
  );
}

function ReceiptFact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View
      style={{
        gap: space[1],
        paddingVertical: space[3],
        borderBottomWidth: 1,
        borderBottomColor: theme.color.field["200"],
      }}
    >
      <Type variant="caption">{label}</Type>
      <Type variant={mono ? "mono" : "bodyStrong"}>{value || "—"}</Type>
    </View>
  );
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GH", {
    dateStyle: "medium",
    timeZone: "Africa/Accra",
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-GH", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Africa/Accra",
  });
}

function titleCase(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "—";
}
