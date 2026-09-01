import { idempotentMutation } from "@/lib/api";
import { authedBlob, authedFetch } from "@/lib/auth";

export type DigitalPaymentMethod = "mobile_money" | "card" | "bank_transfer";
export type ReceiptPaymentMethod = DigitalPaymentMethod | "MOBILE_MONEY" | "CARD" | "BANK_TRANSFER" | "CASH" | "OTHER";
export type PaymentIntentStatus = "created" | "pending" | "processing" | "succeeded" | "failed" | "expired" | "cancelled";

export type PaymentIntent = {
  id: string;
  lease_id: string;
  obligation_id: string;
  obligation_kind: string;
  property_title: string;
  unit_label: string;
  amount_minor: number;
  amount_currency: string;
  amount_formatted: string;
  status: PaymentIntentStatus;
  payment_method: DigitalPaymentMethod;
  provider: string;
  client_reference: string;
  provider_reference: string;
  expires_at: string;
  failure_code: string;
  failure_message: string;
  next_action: { type?: string; url?: string; access_code?: string };
  receipt_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentReceipt = {
  id: string;
  receipt_number: string;
  issued_at: string;
  amount_formatted: string;
  payment_method: ReceiptPaymentMethod;
  provider: string;
  provider_transaction_id: string;
  source: "PLATFORM_PSP" | "EXTERNAL";
  evidence: "PSP_CONFIRMED" | "COUNTERPARTY_CONFIRMED";
  snapshot: ReceiptSnapshot | null;
  final_document_available: boolean;
  breakdown: Record<string, unknown>;
};

export type ReceiptSnapshot = {
  schema_version: "rooomly.payment_receipt.v1";
  receipt_number: string;
  issued_at: string;
  tenant: { account_id: string; name: string };
  provider: {
    signer_account_id: string;
    signer_name: string;
    organization_id: string | null;
    organization_name: string;
  };
  premises: {
    property_id: string;
    property_title: string;
    unit_id: string;
    unit_label: string;
    bed_id: string | null;
    bed_label: string;
    space_type: string;
    space_type_label: string;
    is_furnished: boolean;
    address: {
      display: string;
      house_number: string;
      street: string;
      landmark: string;
      digital_address: string;
      locality: string;
      district: string;
      region: string;
    };
  };
  obligation: {
    id: string | null;
    kind: string;
    kind_label: string;
    due_on: string | null;
    period_start: string | null;
    period_end: string | null;
  };
  payment: {
    amount_minor: number;
    currency: string;
    method: ReceiptPaymentMethod;
    method_label: string;
    paid_at: string;
    source: "PLATFORM_PSP" | "EXTERNAL";
    source_label: string;
    reference?: string;
    note?: string;
  };
  processor: { name: string; transaction_id: string; provider_reference: string };
  evidence: { status: string; label: string; filename?: string };
  stamp: { status: "not_assessed"; notice: string };
};

export function listPaymentIntents() {
  return authedFetch<PaymentIntent[]>("/payments/intents/");
}

export function getPaymentIntent(id: string) {
  return authedFetch<PaymentIntent>(`/payments/intents/${id}/`);
}

/** `amountMinor` is a request, not a price: the server bounds it against the
 * locked outstanding balance. Omit it to pay the whole remaining balance. */
export function createPaymentIntent(
  obligationId: string,
  paymentMethod: DigitalPaymentMethod,
  amountMinor?: number,
) {
  return authedFetch<PaymentIntent>("/payments/intents/", {
    method: "POST",
    body: JSON.stringify({
      obligation_id: obligationId,
      payment_method: paymentMethod,
      ...(amountMinor === undefined ? {} : { amount_minor: amountMinor }),
    }),
    ...idempotentMutation(),
  });
}

export function retryPaymentIntent(id: string) {
  return authedFetch<PaymentIntent>(`/payments/intents/${id}/retry/`, {
    method: "POST",
    body: JSON.stringify({}),
    ...idempotentMutation(),
  });
}

export function refreshPaymentIntent(id: string) {
  return authedFetch<PaymentIntent>(`/payments/intents/${id}/refresh/`, {
    method: "POST",
    body: JSON.stringify({}),
    ...idempotentMutation(),
  });
}

export function getPaymentReceipt(id: string) {
  return authedFetch<PaymentReceipt>(`/payments/receipts/${id}/`);
}

export function getPaymentReceiptDocument(id: string) {
  return authedBlob(`/payments/receipts/${id}/document.pdf?disposition=inline`);
}

/** Only the PSP-hosted origin may receive a tenant from Rooomly. The URL is
 * server-created, but this second boundary prevents a compromised payload from
 * turning checkout into an open redirect. */
export function safeCheckoutUrl(intent: PaymentIntent): string | null {
  if (intent.next_action?.type !== "redirect" || !intent.next_action.url) return null;
  try {
    const url = new URL(intent.next_action.url);
    const paystackHost = url.hostname === "paystack.com" || url.hostname.endsWith(".paystack.com");
    return url.protocol === "https:" && paystackHost ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Paystack's transaction access code is safe to pass to InlineJS and is not a
 * reusable payment authorization. Reject whitespace/control characters before
 * handing any server payload to the third-party popup library. */
export function paystackAccessCode(intent: PaymentIntent): string | null {
  if (intent.provider.toLowerCase() !== "paystack") return null;
  const value = intent.next_action?.access_code?.trim() ?? "";
  return value && /^[A-Za-z0-9._=-]+$/.test(value) ? value : null;
}

export function paymentMethodLabel(method: ReceiptPaymentMethod): string {
  return {
    mobile_money: "Mobile money",
    card: "Card",
    bank_transfer: "Bank transfer",
    MOBILE_MONEY: "Mobile money",
    CARD: "Card",
    BANK_TRANSFER: "Bank transfer",
    CASH: "Cash",
    OTHER: "Other",
  }[method];
}
