/**
 * How Plan & billing reads, derived from what the server returned.
 *
 * Every function here takes server state and returns words and numbers for a
 * screen. None of them decides anything: which plan is higher comes from the
 * catalogue's own ladder, every limit and price from the server, and every
 * standing from the subscription's recorded state. There is no plan code in
 * this file and there must never be one — a screen that branches on "PRO" is
 * wrong the day Pro is repackaged.
 *
 * Mirrors `web/src/lib/billingPresentation.ts`, held in step by
 * `billingScreen.contract.test.mjs`, so a Portfolio reads the same on a phone as
 * in a browser. The differences are only in how numbers and dates are printed:
 * those use no `Intl` here, because a phone's copy of the locale data is not
 * the browser's.
 */

import type {
  AccessState,
  AllowanceUse,
  BillingInterval,
  BillingPaymentRecord,
  EntitlementMeta,
  KeepActive,
  PlanCatalogue,
  PlanChangeQuote,
  PlanSummary,
  PortfolioBilling,
  ResourceChoice,
} from "@/billing";

export type Tone = "positive" | "neutral" | "info" | "warning" | "critical";

// --- money and dates ----------------------------------------------------------

const SYMBOLS: Record<string, string> = { GHS: "GH₵" };

/** 1234567 → "1,234,567". */
export function grouped(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** An amount someone is charged or has paid, always exact: "GH₵246.60". */
export function formatAmount(minor: number, currency: string): string {
  const whole = Math.round(Math.abs(minor));
  const pesewas = String(whole % 100).padStart(2, "0");
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  return `${minor < 0 ? "-" : ""}${symbol}${grouped(Math.floor(whole / 100))}.${pesewas}`;
}

/** A plan price, trimmed to whole cedis when it has no pesewas: "GH₵89". */
export function formatPrice(minor: number, currency: string): string {
  const exact = formatAmount(minor, currency);
  return exact.endsWith(".00") ? exact.slice(0, -3) : exact;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  // The server sends microseconds; not every JavaScript engine parses more
  // than three fractional digits.
  const date = new Date(value.replace(/(\.\d{3})\d+/, "$1"));
  if (Number.isNaN(date.getTime())) return "";
  // Danpa HQ's calendar is Ghana's, and Ghana keeps GMT all year, so the UTC
  // date is the Accra date — without asking the phone for time-zone data.
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? ""} ${date.getUTCFullYear()}`;
}

export function intervalLabel(interval: BillingInterval): string {
  return interval === "annual" ? "Annual" : "Monthly";
}

export function periodWord(interval: BillingInterval): string {
  return interval === "annual" ? "year" : "month";
}

// --- the catalogue ------------------------------------------------------------

type Priced = Pick<PlanSummary, "monthly_price_minor" | "annual_price_minor">;

export function planPrice(plan: Priced, interval: BillingInterval): number | null {
  return interval === "annual" ? plan.annual_price_minor : plan.monthly_price_minor;
}

export function isFreePlan(plan: Priced): boolean {
  return plan.monthly_price_minor <= 0 && !plan.annual_price_minor;
}

export function rankOf(catalogue: PlanCatalogue, code: string): number {
  return catalogue.upgrade_order.indexOf(code);
}

export function planByCode(catalogue: PlanCatalogue, code: string): PlanSummary | undefined {
  return catalogue.plans.find((plan) => plan.code === code);
}

export function planName(catalogue: PlanCatalogue, code: string): string {
  return planByCode(catalogue, code)?.name ?? sentenceCase(code);
}

/** The lowest rung of the ladder — where a Portfolio lands when it leaves a paid plan. */
export function baseplan(catalogue: PlanCatalogue): PlanSummary | undefined {
  const code = catalogue.upgrade_order[0];
  return code ? planByCode(catalogue, code) : catalogue.plans[0];
}

export function entitlementName(catalogue: PlanCatalogue, key: string): string {
  return catalogue.entitlements.find((item) => item.key === key)?.name ?? sentenceCase(key);
}

/** "1 property", "10 properties", "Unlimited team members". */
export function countLabel(count: number | null, name: string): string {
  const noun = name.toLowerCase();
  if (count === null) return `Unlimited ${noun}`;
  const singular = noun.endsWith("ies") ? `${noun.slice(0, -3)}y` : noun.endsWith("s") ? noun.slice(0, -1) : noun;
  return `${grouped(count)} ${count === 1 ? singular : noun}`;
}

/** "2 months free" when annual billing saves whole months, otherwise a percentage. */
export function annualSaving(plan: Priced): string | null {
  const annual = plan.annual_price_minor;
  const monthly = plan.monthly_price_minor;
  if (!annual || monthly <= 0) return null;
  const saved = monthly * 12 - annual;
  if (saved <= 0) return null;
  if (saved % monthly === 0) {
    const months = saved / monthly;
    return `${months} month${months === 1 ? "" : "s"} free`;
  }
  return `Save ${Math.round((saved / (monthly * 12)) * 100)}%`;
}

/** The saving to name on the billing-cycle switch, if every paid plan agrees on it. */
export function catalogueSaving(catalogue: PlanCatalogue): string | null {
  const savings = catalogue.plans.filter((plan) => !isFreePlan(plan)).map(annualSaving);
  const first = savings[0];
  return first && savings.every((value) => value === first) ? first : null;
}

/**
 * The price line under a paid plan's price, for either cycle.
 *
 * Both cycles carry one, so switching between them changes words, not the
 * height of every card: monthly names the yearly alternative, annual the
 * monthly equivalent. Empty only when there is no other cycle to name.
 */
export function priceNote(plan: Priced & { currency: string }, interval: BillingInterval): string {
  if (isFreePlan(plan)) return "No billing required";
  if (interval === "annual") {
    return plan.annual_price_minor ? `${formatAmount(Math.round(plan.annual_price_minor / 12), plan.currency)} a month, billed yearly` : "";
  }
  return plan.annual_price_minor ? `or ${formatPrice(plan.annual_price_minor, plan.currency)} a year` : "";
}

export type PlanOption = {
  plan: PlanSummary;
  isCurrent: boolean;
  recommended: boolean;
  price: number | null;
  limits: string[];
  /** "Everything in Pro, plus" — when the rung below has capabilities of its own. */
  inherits: string | null;
  highlights: string[];
  action: null | { kind: "upgrade" | "downgrade" | "renew"; label: string };
  /** Why this plan cannot be chosen at this billing cycle, when it cannot. */
  unavailable: string | null;
};

export function planOptions(
  catalogue: PlanCatalogue,
  billing: PortfolioBilling,
  interval: BillingInterval,
): PlanOption[] {
  const currentCode = currentPlanOf(billing, catalogue).code;
  const currentRank = rankOf(catalogue, currentCode);
  return catalogue.plans.map((plan, index) => {
    const rank = rankOf(catalogue, plan.code);
    const isCurrent = plan.code === currentCode;
    const previous = index > 0 ? catalogue.plans[index - 1] : undefined;
    const price = planPrice(plan, interval);
    const pays = rank > currentRank || (isCurrent && billing.renewal.available);
    let action: PlanOption["action"] = null;
    if (billing.viewer.can_change_plan) {
      if (isCurrent && billing.renewal.available) action = { kind: "renew", label: `Renew ${plan.name}` };
      else if (rank > currentRank) action = { kind: "upgrade", label: `Upgrade to ${plan.name}` };
      else if (rank < currentRank) action = { kind: "downgrade", label: `Switch to ${plan.name}` };
    }
    return {
      plan,
      isCurrent,
      recommended: catalogue.recommended_plan === plan.code && rank > currentRank,
      price,
      limits: catalogue.headline_limits.map((key) => {
        const value = plan.entitlements[key];
        const count = value?.unlimited ? null : typeof value?.value === "number" ? value.value : 0;
        return countLabel(count, entitlementName(catalogue, key));
      }),
      inherits: previous && previous.highlights.length ? `Everything in ${previous.name}, plus` : null,
      highlights: plan.highlights.map((key) => entitlementName(catalogue, key)),
      action,
      unavailable:
        pays && (price === null || price <= 0)
          ? `${intervalLabel(interval)} billing isn't offered for ${plan.name}`
          : null,
    };
  });
}

export type ComparisonGroup = {
  group: string;
  rows: { meta: EntitlementMeta; values: { code: string; text: string; included: boolean }[] }[];
};

/** The full matrix, for the few who ask to compare everything. */
export function comparison(catalogue: PlanCatalogue): ComparisonGroup[] {
  return catalogue.groups.map((group) => ({
    group,
    rows: catalogue.entitlements
      .filter((meta) => meta.group === group)
      .map((meta) => ({
        meta,
        values: catalogue.plans.map((plan) => {
          const value = plan.entitlements[meta.key];
          if (!value) return { code: plan.code, text: "Not included", included: false };
          if (value.unlimited) return { code: plan.code, text: "Unlimited", included: true };
          if (meta.value_type === "boolean") {
            return { code: plan.code, text: value.value ? "Included" : "Not included", included: Boolean(value.value) };
          }
          const count = typeof value.value === "number" ? value.value : 0;
          return { code: plan.code, text: grouped(count), included: count > 0 };
        }),
      })),
  }));
}

// --- this Portfolio -----------------------------------------------------------

export type ShownPlan = {
  code: string;
  name: string;
  description: string;
  monthly_price_minor: number;
  annual_price_minor: number | null;
  currency: string;
  rank: number;
};

/**
 * The plan the screen leads with: the subscription's while it is live — a
 * past-due Pro subscription is still Pro — otherwise the plan whose limits apply.
 */
export function currentPlanOf(billing: PortfolioBilling, catalogue: PlanCatalogue): ShownPlan {
  const subscription = billing.subscription;
  const live = subscription?.is_live ? subscription.plan : null;
  const source = live ?? billing.plan;
  const listed = planByCode(catalogue, source.code);
  return {
    code: source.code,
    name: source.name,
    description: listed?.description ?? source.description,
    monthly_price_minor: source.monthly_price_minor,
    annual_price_minor: listed?.annual_price_minor ?? live?.annual_price_minor ?? null,
    currency: source.currency,
    rank: rankOf(catalogue, source.code),
  };
}

export type MeterState = "ok" | "near" | "full" | "over" | "unlimited";

export type Meter = {
  key: string;
  name: string;
  /** Fully active — what the limit is measured against. */
  used: number;
  limit: number | null;
  /** Held above the allowance and restricted: kept, not counted. */
  restricted: number;
  state: MeterState;
  /** 0–1, for the bar. The number beside it never depends on the bar. */
  fill: number;
  note: string;
  valueText: string;
};

export function metersOf(billing: PortfolioBilling, catalogue: PlanCatalogue): Meter[] {
  return catalogue.headline_limits.map((key) => {
    const name = entitlementName(catalogue, key);
    const metric = billing.usage_for_limit[key];
    // Measured against what runs in full. Anything held above the allowance is
    // restricted rather than counted, and is said beside the number, not in it.
    const used = metric ? (billing.active_usage?.[metric] ?? billing.usage[metric] ?? 0) : 0;
    const held = metric ? (billing.usage[metric] ?? used) : used;
    const restricted = Math.max(held - used, 0);
    const limit = billing.limits[key] ?? null;
    const noun = name.toLowerCase();
    const aside = restricted ? ` · ${restricted} restricted` : "";
    const heldText = restricted ? `, ${restricted} more restricted` : "";
    if (limit === null) {
      return {
        key,
        name,
        used,
        limit,
        restricted,
        state: "unlimited",
        fill: 0,
        note: `Unlimited${aside}`,
        valueText: `${used} ${noun}, no limit${heldText}`,
      };
    }
    const state: MeterState =
      used > limit ? "over" : used === limit ? "full" : limit > 0 && used / limit >= 0.8 ? "near" : "ok";
    const standing = state === "over" ? `${used - limit} over limit` : state === "full" ? "Limit reached" : `${limit - used} left`;
    return {
      key,
      name,
      used,
      limit,
      restricted,
      state,
      fill: limit <= 0 ? (used > 0 ? 1 : 0) : Math.min(1, used / limit),
      note: `${standing}${aside}`,
      valueText: `${used} of ${countLabel(limit, name)}${heldText}`,
    };
  });
}

export type StandingAction = { kind: "renew" | "keep" | "continue_payment"; label: string };

export type Standing = {
  /** Beside the plan name. Absent when there is nothing to say — Free is just Free. */
  badge: null | { tone: Tone; label: string };
  /** The one line under the price. */
  line: string;
  /** Only when something needs attention or is about to change. */
  attention: null | { tone: Tone; title: string; body: string; action: StandingAction | null };
  /** Under the meters, when the limits in force are not the plan shown. */
  limitsNote: string | null;
};

export function standingOf(billing: PortfolioBilling, catalogue: PlanCatalogue): Standing {
  const standing = standingOfSubscription(billing, catalogue);
  // Restrictions are the quietest thing worth a strip: anything more pressing —
  // a payment, a renewal, a change about to happen — keeps the one place.
  const restricted = restrictionSummary(billing);
  if (!standing.attention && restricted) {
    return { ...standing, attention: { tone: "warning", title: restricted.title, body: restricted.body, action: null } };
  }
  return standing;
}

function standingOfSubscription(billing: PortfolioBilling, catalogue: PlanCatalogue): Standing {
  const subscription = billing.subscription;
  const plan = currentPlanOf(billing, catalogue);
  const base = baseplan(catalogue)?.name ?? billing.plan.name;
  const canPay = billing.viewer.can_change_plan && billing.checkout.available;
  const renew: StandingAction | null =
    canPay && billing.renewal.available ? { kind: "renew", label: `Renew ${plan.name}` } : null;
  const keep: StandingAction | null = billing.viewer.can_change_plan ? { kind: "keep", label: `Keep ${plan.name}` } : null;
  const open = billing.checkout.open;

  const standing: Standing = { badge: null, line: "No billing required", attention: null, limitsNote: null };

  if (!subscription) return standing;

  if (billing.billing_account?.status === "closed") {
    return { ...standing, badge: { tone: "neutral", label: "Billing closed" }, line: `${billing.plan.name} limits apply` };
  }

  if (!subscription.is_live) {
    return {
      ...standing,
      badge: { tone: "neutral", label: sentenceCase(subscription.status) },
      line: `Your ${subscription.plan.name} subscription has ended`,
    };
  }

  const periodEnd = formatDate(subscription.current_period_end);
  switch (true) {
    case subscription.status === "past_due":
      Object.assign(standing, {
        badge: { tone: "critical", label: "Past due" },
        line: `Payment was due ${formatDate(subscription.current_period_start)}`,
        attention: {
          tone: "critical",
          title: `Renew ${plan.name} to restore its limits`,
          body: `Until then, ${billing.plan.name} limits apply: anything above them is restricted — never removed — and new rental activity on it waits. Renewing lets you reactivate it.`,
          action: renew,
        },
        limitsNote: `Limits follow ${billing.plan.name} until ${plan.name} is renewed.`,
      });
      break;
    case subscription.status === "grace_period":
      Object.assign(standing, {
        badge: { tone: "warning", label: "Renewal due" },
        line: `Renew by ${formatDate(subscription.grace_expires_at)}`,
        attention: {
          tone: "warning",
          title: `${plan.name} renewal is due`,
          body: `${plan.name} stays on until ${formatDate(subscription.grace_expires_at)}. Renew before then to keep its limits.`,
          action: renew,
        },
      });
      break;
    case subscription.cancel_at_period_end:
      Object.assign(standing, {
        badge: { tone: "neutral", label: "Ending" },
        line: `Moves to ${base} on ${periodEnd}`,
        attention: {
          tone: "neutral",
          title: `${plan.name} ends on ${periodEnd}`,
          body: `After that this Portfolio moves to ${base}. Your records stay safe: anything above ${base}'s limits is restricted, never deleted.`,
          action: keep,
        },
      });
      break;
    case subscription.scheduled_plan !== null:
      Object.assign(standing, {
        badge: { tone: "neutral", label: "Changing" },
        line: `Moves to ${subscription.scheduled_plan?.name} on ${periodEnd}`,
        attention: {
          tone: "neutral",
          title: `Switching to ${subscription.scheduled_plan?.name} on ${periodEnd}`,
          body: `${plan.name} stays on until then.`,
          action: keep,
        },
      });
      break;
    case subscription.funding === "complimentary": {
      const usual = planPrice(plan, subscription.billing_interval) ?? plan.monthly_price_minor;
      Object.assign(standing, {
        badge: { tone: "positive", label: "Active" },
        line: `Included by Danpa HQ · usually ${formatPrice(usual, plan.currency)} / ${periodWord(subscription.billing_interval)}`,
      });
      break;
    }
    case subscription.funding === "paid":
      Object.assign(standing, { badge: { tone: "positive", label: "Active" }, line: `Paid until ${periodEnd}` });
      break;
    default:
      break;
  }

  // A payment in flight is the most recent thing the person did, so it leads.
  if (open) {
    standing.attention = {
      tone: "info",
      title: "Payment pending",
      body: `${formatAmount(open.amount_minor, open.currency)} for ${open.invoice.plan.name}. Your plan changes as soon as the payment is confirmed.`,
      action: billing.viewer.can_change_plan ? { kind: "continue_payment", label: "Check payment" } : null,
    };
  } else if (!standing.attention && billing.billing_account?.status === "restricted") {
    standing.attention = {
      tone: "warning",
      title: "Billing is restricted",
      body: "Some billing actions are unavailable for this Portfolio.",
      action: null,
    };
  }
  return standing;
}

export function paymentStatusOf(record: BillingPaymentRecord): { tone: Tone; label: string } {
  switch (record.payment.status) {
    case "succeeded":
      return { tone: "positive", label: "Paid" };
    case "failed":
      return { tone: "critical", label: "Failed" };
    default:
      return { tone: "info", label: "Pending" };
  }
}

export function invoiceDescription(record: BillingPaymentRecord): string {
  const what = record.kind === "renewal" ? `${record.plan.name} renewal` : record.plan.name;
  return `${what} · ${intervalLabel(record.billing_interval)}`;
}

/** "30 Aug – 29 Sep 2026", naming the year once when both ends share it. */
export function periodRange(start: string | null, end: string | null): string {
  if (!start || !end) return "";
  const from = formatDate(start);
  const to = formatDate(end);
  const year = to.slice(to.lastIndexOf(" "));
  return from.endsWith(year) ? `${from.slice(0, -year.length)} – ${to}` : `${from} – ${to}`;
}

/**
 * One line of facts under a payment: when, what it covered, which invoice.
 *
 * A payment that starts a period on the day it was made names only the end of
 * that period rather than printing the same date twice.
 */
export function paymentFacts(record: BillingPaymentRecord): string[] {
  const occurred = formatDate(record.payment.occurred_at ?? record.issued_at);
  const verb = record.payment.status === "succeeded" ? "Paid" : record.payment.status === "failed" ? "Tried" : "Started";
  const start = formatDate(record.period_start);
  const covers = !record.period_end
    ? ""
    : start === occurred
      ? `until ${formatDate(record.period_end)}`
      : periodRange(record.period_start, record.period_end);
  return [`${verb} ${occurred}`, covers, record.number].filter(Boolean);
}

/** One plain sentence per subscription event, named from the catalogue. */
export function historyLine(event: PortfolioBilling["history"][number], catalogue: PlanCatalogue): string {
  const to = event.to_plan_code ? planName(catalogue, event.to_plan_code) : "";
  const from = event.from_plan_code ? planName(catalogue, event.from_plan_code) : "";
  switch (event.event_type) {
    case "subscription_created":
      return `Started on ${to}`;
    case "plan_changed":
      return rankOf(catalogue, event.to_plan_code) > rankOf(catalogue, event.from_plan_code)
        ? `Upgraded from ${from} to ${to}`
        : `Moved from ${from} to ${to}`;
    case "renewed":
      return `Renewed ${to}`;
    case "entered_grace":
      return `${to} renewal became due`;
    case "past_due":
      return `${to} became past due`;
    case "restored":
      return `${to} restored`;
    case "cancelled":
      return `Scheduled to move to ${baseplan(catalogue)?.name ?? to} at the end of the period`;
    case "change_scheduled":
      return `Scheduled to move to ${to} at the end of the period`;
    case "scheduled_change_cancelled":
      return `Kept ${from}`;
    case "override_applied":
    case "override_removed":
      return "Limits adjusted by Danpa HQ";
    default:
      return event.event_type_display;
  }
}

/** What a downgrade review compares: what the Portfolio runs against what it would include. */
export function downgradeRows(quote: PlanChangeQuote, billing: PortfolioBilling, catalogue: PlanCatalogue) {
  const target = planByCode(catalogue, quote.plan.code);
  return catalogue.headline_limits.map((key) => {
    const name = entitlementName(catalogue, key);
    const metric = billing.usage_for_limit[key];
    const used = metric ? (billing.active_usage?.[metric] ?? billing.usage[metric] ?? 0) : 0;
    const over = quote.over_limit.find((row) => row.entitlement === key);
    const value = target?.entitlements[key];
    const included = over ? over.limit : value?.unlimited ? null : typeof value?.value === "number" ? value.value : 0;
    return {
      key,
      name,
      used: countLabel(used, name),
      included: countLabel(included, name),
      over: included !== null && used > included,
    };
  });
}

// --- above the allowance ---------------------------------------------------------

/** How a property's or unit's access reads. Always a word; the tone only reinforces it. */
export function accessStatusOf(state: AccessState): { tone: Tone; label: string } {
  if (state === "wind_down") return { tone: "warning", label: "Winding down" };
  if (state === "read_only") return { tone: "neutral", label: "Read-only" };
  return { tone: "positive", label: "Fully active" };
}

/** "1 of 1 property fully active", or "12 units fully active" when there is no limit. */
export function allowanceLine(use: AllowanceUse, name: string): string {
  if (use.limit === null) return `${countLabel(use.active, name)} fully active`;
  return `${use.active} of ${countLabel(use.limit, name)} fully active`;
}

/** What is restricted, as a heading and a sentence — or nothing, when nothing is. */
export function restrictionSummary(billing: PortfolioBilling): null | { title: string; body: string } {
  const access = billing.resource_access;
  if (!access) return null;
  const properties = access.properties.wind_down + access.properties.read_only;
  const units = access.restricted.filter((row) => row.kind === "unit").length;
  if (!properties && !units) return null;
  const subject = [properties ? countLabel(properties, "Properties") : "", units ? countLabel(units, "Units") : ""]
    .filter(Boolean)
    .join(" and ");
  return {
    title: `${subject} ${properties + units === 1 ? "is" : "are"} above ${billing.plan.name}'s limits`,
    body: "Their records stay available and existing tenancies continue, but new rental activity on them needs plan capacity or an upgrade.",
  };
}

// --- what stays fully active after a downgrade ----------------------------------------
//
// A whole choice keeps exactly as many as the plan runs. The server would fill
// any place left open in its own order, but a review that says one thing and a
// fill that does another is exactly the surprise this step exists to prevent —
// so the review asks for the whole choice, and opens on the server's own.

/** How many a whole choice keeps: every one, or as many as the plan runs. */
function placesFor(total: number, limit: number | null): number {
  return limit === null ? total : Math.max(Math.min(limit, total), 0);
}

/** How many properties a whole choice keeps. */
export function propertyPlaces(choice: ResourceChoice): number {
  return placesFor(choice.properties.length, choice.limits.properties);
}

/** Whether properties need choosing: more are fully active than the plan runs. */
export function propertiesNeedChoosing(choice: ResourceChoice): boolean {
  return choice.required && choice.properties.length > propertyPlaces(choice);
}

/** The properties that stay fully active: the ones chosen, or every one when none need choosing. */
export function keptPropertyIds(choice: ResourceChoice, keep: KeepActive): string[] {
  return propertiesNeedChoosing(choice) ? keep.property_ids : choice.properties.map((property) => property.id);
}

/** The units the kept properties hold, in the server's order. */
export function unitsOfKept(choice: ResourceChoice, propertyIds: readonly string[]) {
  const kept = new Set(propertyIds);
  return choice.properties
    .filter((property) => kept.has(property.id))
    .flatMap((property) => property.units.map((unit) => ({ ...unit, propertyTitle: property.title })));
}

/** How many units a whole choice keeps inside the kept properties. */
export function unitPlaces(choice: ResourceChoice, propertyIds: readonly string[]): number {
  return placesFor(unitsOfKept(choice, propertyIds).length, choice.limits.units);
}

/** Whether units need choosing as well: the kept properties hold more than the plan runs. */
export function unitsNeedChoosing(choice: ResourceChoice, propertyIds: readonly string[]): boolean {
  return choice.required && unitsOfKept(choice, propertyIds).length > unitPlaces(choice, propertyIds);
}

/**
 * The units kept once the kept properties change: those already ticked that
 * still apply, then the server's own selection, then the rest in the server's
 * order — up to the limit. They are shown ticked, so none is applied silently.
 */
export function unitsFor(choice: ResourceChoice, propertyIds: readonly string[], ticked: readonly string[]): string[] {
  if (!unitsNeedChoosing(choice, propertyIds)) return [];
  const rank = (id: string) => (ticked.includes(id) ? 0 : choice.selected.unit_ids.includes(id) ? 1 : 2);
  // A stable sort: within each rank the server's order stands.
  return [...unitsOfKept(choice, propertyIds)]
    .sort((a, b) => rank(a.id) - rank(b.id))
    .slice(0, unitPlaces(choice, propertyIds))
    .map((unit) => unit.id);
}

/**
 * What the review opens on: the server's selection — the saved choice, or its
 * fallback. Only what needs choosing is carried, so a choice nobody was asked
 * to make is never sent as though they had made it.
 */
export function initialKeep(choice: ResourceChoice | null): KeepActive {
  if (!choice?.required) return { property_ids: [], unit_ids: [] };
  const property_ids = propertiesNeedChoosing(choice) ? [...choice.selected.property_ids] : [];
  return { property_ids, unit_ids: unitsFor(choice, keptPropertyIds(choice, { property_ids, unit_ids: [] }), []) };
}

/** Whether the choice is whole: exactly as many kept as the plan runs, each of them eligible. */
export function keepComplete(choice: ResourceChoice | null, keep: KeepActive): boolean {
  if (!choice?.required) return true;
  const whole = (chosen: readonly string[], eligible: readonly string[], places: number) =>
    new Set(chosen).size === chosen.length && chosen.length === places && chosen.every((id) => eligible.includes(id));
  if (propertiesNeedChoosing(choice)) {
    const eligible = choice.properties.map((property) => property.id);
    if (!whole(keep.property_ids, eligible, propertyPlaces(choice))) return false;
  }
  const kept = keptPropertyIds(choice, keep);
  if (!unitsNeedChoosing(choice, kept)) return true;
  return whole(keep.unit_ids, unitsOfKept(choice, kept).map((unit) => unit.id), unitPlaces(choice, kept));
}

/** "6 units · 5 with a tenancy in progress" — what restricting it would wind down. */
export function keepPropertyNote(property: ResourceChoice["properties"][number]): string {
  const units = countLabel(property.units.length, "Units");
  const running = property.units.filter((unit) => unit.running).length;
  if (!running) return `${units} · no tenancy in progress`;
  if (property.units.length === 1) return `${units} · tenancy in progress`;
  return `${units} · ${running} with a tenancy in progress`;
}

/** What happens to the properties not kept, in the review's own words. */
export function propertyConsequence(choice: ResourceChoice): string {
  const others = choice.properties.length - propertyPlaces(choice);
  if (others <= 0) return "";
  return `${others} other ${others === 1 ? "property" : "properties"} will remain accessible. Existing tenancies can continue, but new rental activity on ${others === 1 ? "it" : "those properties"} will be restricted.`;
}

/** And to the units not kept inside the properties that are. */
export function unitConsequence(choice: ResourceChoice, propertyIds: readonly string[]): string {
  const others = unitsOfKept(choice, propertyIds).length - unitPlaces(choice, propertyIds);
  if (others <= 0) return "";
  return `${others} other ${others === 1 ? "unit" : "units"} will remain accessible. Existing tenancies can continue, but new rental activity on ${others === 1 ? "it" : "those units"} will be restricted.`;
}

export function sentenceCase(value: string): string {
  const readable = value.replace(/_/g, " ").toLowerCase();
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}
