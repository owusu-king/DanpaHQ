/**
 * Plan & billing: what a Portfolio is on, what it may do, and how it pays Danpa HQ.
 *
 * Two reads describe the page. The catalogue is public and carries every plan's
 * price, limits and lead capabilities, and the name of every entitlement, so no
 * screen keeps its own copy of the package ladder. The Portfolio read is this
 * Portfolio's own state — subscription, live usage, limits, invoices, any
 * payment in flight, what is restricted above the plan's allowance — and what the
 * signed-in person may do about it.
 *
 * Neither is authority. Every limit is checked again on the server when
 * something is created, and a plan moves only when the server has confirmed a
 * payment with the provider. Nothing below reports a payment as successful on
 * its own: every function returns what the server says.
 *
 * Subscription billing shares the Payments Core with rent — the same provider,
 * popup and receipts — but it is a different business concept with different
 * endpoints, and nothing here reads or writes a rent record.
 */

import { idempotentMutation } from "@/lib/api";
import { authedFetch } from "@/lib/auth";
import type { DigitalPaymentMethod, PaymentIntentStatus } from "@/lib/payments";

export type PlanCode = "FREE" | "PRO" | "BUSINESS";
export type BillingInterval = "monthly" | "annual";
export type PlanRef = { code: PlanCode; name: string };

export type EntitlementValue = { value: number | boolean | null; unlimited: boolean };

export type EntitlementMeta = {
  key: string;
  group: string;
  name: string;
  description: string;
  value_type: "integer" | "boolean";
};

export type PlanSummary = {
  code: PlanCode;
  name: string;
  description: string;
  monthly_price_minor: number;
  annual_price_minor: number | null;
  currency: string;
  entitlements: Record<string, EntitlementValue>;
  /** Entitlement keys this plan leads with, only ever ones it grants. */
  highlights: string[];
};

export type PlanCatalogue = {
  entitlements: EntitlementMeta[];
  groups: string[];
  headline_limits: string[];
  upgrade_order: string[];
  recommended_plan: PlanCode | null;
  plans: PlanSummary[];
};

export type SubscriptionStatus = "active" | "grace_period" | "past_due" | "cancelled" | "expired";

/** `paid` has a paid period behind it; `complimentary` is a paid plan nobody paid for. */
export type Funding = "free" | "paid" | "complimentary";

export type BillingInvoice = {
  id: string;
  number: string;
  kind: "plan_change" | "renewal";
  status: "open" | "paid" | "void";
  plan: PlanRef;
  billing_interval: BillingInterval;
  list_price_minor: number;
  credit_minor: number;
  amount_minor: number;
  currency: string;
  issued_at: string;
  expires_at: string;
  paid_at: string | null;
  period_start: string | null;
  period_end: string | null;
};

export type BillingPaymentRecord = BillingInvoice & {
  payment: {
    status: "succeeded" | "pending" | "processing" | "failed";
    method: DigitalPaymentMethod | "";
    occurred_at: string | null;
    failure_message: string;
    receipt_id: string | null;
  };
};

/** One subscription payment attempt, as the server holds it. */
export type SubscriptionCheckout = {
  id: string;
  status: PaymentIntentStatus;
  payment_method: DigitalPaymentMethod;
  provider: string;
  amount_minor: number;
  currency: string;
  expires_at: string;
  failure_code: string;
  failure_message: string;
  next_action: { type?: string; url?: string; access_code?: string };
  receipt_id: string | null;
  invoice: BillingInvoice;
};

export type OverLimit = { entitlement: string; current: number; limit: number };

/**
 * Where a property or unit stands against its Portfolio's plan allowance.
 *
 * `full` runs normally. `wind_down` is above the allowance with a tenancy or an
 * agreement still running: that continues to its end, and nothing new starts.
 * `read_only` is above the allowance with nothing running: records stay
 * available, nothing new starts. Rendered only — the server refuses regardless.
 */
export type AccessState = "full" | "wind_down" | "read_only";

/** What a property or unit read says about its access, in the server's words. */
export type BillingAccess = { state: AccessState; label: string; message: string };

/** One kind of resource against its allowance: what runs, what is restricted, what room is left. */
export type AllowanceUse = {
  active: number;
  wind_down: number;
  read_only: number;
  limit: number | null;
  available: number | null;
};

export type RestrictedResource = {
  kind: "property" | "unit";
  id: string;
  property_id: string;
  name: string;
  property_name: string;
  state: Exclude<AccessState, "full">;
  restricted_at: string;
};

export type ResourceAccessSummary = {
  properties: AllowanceUse;
  units: AllowanceUse;
  restricted: RestrictedResource[];
};

export type PortfolioBilling = {
  /** The plan whose limits are enforced right now. */
  plan: { code: PlanCode; name: string; description: string; monthly_price_minor: number; currency: string };
  /** The billing relationship — which can differ from `plan`, e.g. past due. */
  subscription: {
    status: SubscriptionStatus;
    is_live: boolean;
    funding: Funding;
    billing_interval: BillingInterval;
    current_period_start: string | null;
    current_period_end: string | null;
    grace_expires_at: string | null;
    cancelled_at: string | null;
    cancel_at_period_end: boolean;
    scheduled_plan: PlanRef | null;
    updated_at: string | null;
    plan: {
      code: PlanCode;
      name: string;
      description: string;
      monthly_price_minor: number;
      annual_price_minor: number | null;
      currency: string;
    };
  } | null;
  billing_account: { status: "active" | "restricted" | "closed"; currency: string; billing_email: string } | null;
  history: Array<{
    id: string;
    event_type: string;
    event_type_display: string;
    from_plan_code: string;
    to_plan_code: string;
    from_status: string;
    to_status: string;
    occurred_at: string;
  }>;
  entitlements: Record<string, EntitlementValue & { source: string }>;
  /** Everything held. */
  usage: Record<string, number>;
  /** What is being run in full — the counts the limits are measured against. */
  active_usage: Record<string, number>;
  limits: Record<string, number | null>;
  /** Which live count each limit is measured against. */
  usage_for_limit: Record<string, string>;
  over_limit: OverLimit[];
  resource_access: ResourceAccessSummary;
  viewer: { can_change_plan: boolean; can_view_invoices: boolean };
  checkout: { available: boolean; methods: DigitalPaymentMethod[]; open: SubscriptionCheckout | null };
  renewal: { available: boolean };
  invoices: BillingPaymentRecord[];
};

/** What a downgrade would leave fully active, and what the Portfolio may choose. */
export type ResourceChoice = {
  /** Whether the move takes the Portfolio above the plan's allowance at all. */
  required: boolean;
  limits: { properties: number | null; units: number | null };
  active: { properties: number; units: number };
  /**
   * The limits this choice settles. Any other limit the Portfolio sits above —
   * team members, say — is not chosen here: what exists stays, and more waits.
   */
  covers: string[];
  /** Fully active properties, in the server's fallback order, with their units. */
  properties: Array<{
    id: string;
    title: string;
    running_units: number;
    units: Array<{ id: string; label: string; running: boolean }>;
  }>;
  /** The saved choice, or what the fallback would keep — what happens if nobody changes it. */
  selected: KeepActive;
};

export type KeepActive = { property_ids: string[]; unit_ids: string[] };

export type PlanChangeQuote = {
  direction: "upgrade" | "downgrade" | "renewal" | "current";
  plan: PlanRef;
  current_plan: PlanRef;
  billing_interval: BillingInterval;
  currency: string;
  list_price_minor: number;
  credit_minor: number;
  amount_minor: number;
  requires_payment: boolean;
  effective: "on_payment" | "period_end" | "now";
  effective_at: string | null;
  period_start: string | null;
  period_end: string | null;
  over_limit: OverLimit[];
  resource_choice: ResourceChoice | null;
  blocked: { code: string; message: string } | null;
};

/** A provider call sits behind these, so they wait longer than an ordinary read. */
const PAYMENT_TIMEOUT_MS = 30_000;

const billingPath = (organizationId: string) => `/organizations/${organizationId}/billing`;

export function getPlanCatalogue() {
  return authedFetch<PlanCatalogue>("/plans/", { cache: "no-store" });
}

export function getPortfolioBilling(organizationId: string) {
  return authedFetch<PortfolioBilling>(`${billingPath(organizationId)}/`, { cache: "no-store" });
}

export function getPlanChangeQuote(organizationId: string, plan: PlanCode, interval: BillingInterval) {
  const query = new URLSearchParams({ plan, interval });
  return authedFetch<PlanChangeQuote>(`${billingPath(organizationId)}/quote/?${query}`, {
    cache: "no-store",
  });
}

/** Opens a server-priced payment. The plan does not change here. */
export function startSubscriptionCheckout(
  organizationId: string,
  input: { plan_code: PlanCode; billing_interval: BillingInterval; payment_method: DigitalPaymentMethod },
) {
  return authedFetch<SubscriptionCheckout>(`${billingPath(organizationId)}/checkout/`, {
    method: "POST",
    body: JSON.stringify(input),
    timeoutMs: PAYMENT_TIMEOUT_MS,
    ...idempotentMutation(),
  });
}

/** What Danpa HQ already knows. No provider call. */
export function getSubscriptionCheckout(organizationId: string, checkoutId: string) {
  return authedFetch<SubscriptionCheckout>(`${billingPath(organizationId)}/checkout/${checkoutId}/`, {
    cache: "no-store",
  });
}

function checkoutAction(organizationId: string, checkoutId: string, action: "refresh" | "retry" | "cancel") {
  return authedFetch<SubscriptionCheckout>(
    `${billingPath(organizationId)}/checkout/${checkoutId}/${action}/`,
    { method: "POST", body: JSON.stringify({}), timeoutMs: PAYMENT_TIMEOUT_MS, ...idempotentMutation() },
  );
}

/** Asks the provider, and applies what it says through the server's one boundary. */
export function refreshSubscriptionCheckout(organizationId: string, checkoutId: string) {
  return checkoutAction(organizationId, checkoutId, "refresh");
}

export function retrySubscriptionCheckout(organizationId: string, checkoutId: string) {
  return checkoutAction(organizationId, checkoutId, "retry");
}

/** Refused by the server unless the provider agrees nothing was taken. */
export function cancelSubscriptionCheckout(organizationId: string, checkoutId: string) {
  return checkoutAction(organizationId, checkoutId, "cancel");
}

/**
 * A move to a cheaper plan: at the end of a paid period, or now. Takes no money.
 *
 * `keepActive` is what the person chose to keep fully active when the move takes
 * the Portfolio above the plan's allowance. Omitted, the server's documented
 * fallback decides — this client never picks on anyone's behalf.
 */
export function changePlanWithoutPayment(organizationId: string, planCode: PlanCode, keepActive?: KeepActive) {
  return authedFetch<PortfolioBilling>(`${billingPath(organizationId)}/plan-change/`, {
    method: "POST",
    body: JSON.stringify({ plan_code: planCode, ...(keepActive ? { keep_active: keepActive } : {}) }),
    ...idempotentMutation(),
  });
}

export function keepCurrentPlan(organizationId: string) {
  return authedFetch<PortfolioBilling>(`${billingPath(organizationId)}/keep-plan/`, {
    method: "POST",
    body: JSON.stringify({}),
    ...idempotentMutation(),
  });
}

/** Bring restricted properties or units back into full use, as far as the plan has room. */
export function reactivateResources(organizationId: string, input: Partial<KeepActive>) {
  return authedFetch<PortfolioBilling>(`${billingPath(organizationId)}/resource-access/reactivate/`, {
    method: "POST",
    body: JSON.stringify({ property_ids: input.property_ids ?? [], unit_ids: input.unit_ids ?? [] }),
    ...idempotentMutation(),
  });
}
