"use client";

import type { CSSProperties } from "react";

import { Button } from "@/components/Button";
import type { PlanCatalogue, PortfolioBilling } from "@/lib/billing";
import {
  currentPlanOf,
  formatPrice,
  isFreePlan,
  metersOf,
  periodWord,
  planPrice,
  standingOf,
  type Meter,
  type Standing,
  type StandingAction,
  type Tone,
} from "@/lib/billingPresentation";

/**
 * The Portfolio's plan at a glance: what it is, what it costs, when it is paid
 * until, how much of it is in use, and the one thing to do next.
 *
 * One surface in two zones, not a grid of cards. The plan identity and its
 * price lead; usage sits beside it on wide screens and under it on narrow
 * ones; a single attention strip appears only when something needs a person —
 * a renewal due, a payment pending, a change about to happen.
 */
export function CurrentPlan({
  billing,
  catalogue,
  busyAction,
  onChangePlan,
  onAction,
}: {
  billing: PortfolioBilling;
  catalogue: PlanCatalogue;
  busyAction: StandingAction["kind"] | null;
  onChangePlan: () => void;
  onAction: (action: StandingAction) => void;
}) {
  const plan = currentPlanOf(billing, catalogue);
  const standing = standingOf(billing, catalogue);
  const free = isFreePlan(plan);
  const interval = free ? "monthly" : (billing.subscription?.billing_interval ?? "monthly");
  const price = free ? 0 : (planPrice(plan, interval) ?? plan.monthly_price_minor);
  // A plan Danpa HQ provides costs this Portfolio nothing, so that is what the
  // price says. Its usual price is in the line underneath, not in display type.
  const complimentary = Boolean(billing.subscription?.is_live && billing.subscription.funding === "complimentary");
  const actionLeads = Boolean(standing.attention?.action && standing.attention.action.kind !== "keep");

  return (
    <section className="billing-plan" data-rank={plan.rank} aria-labelledby="billing-plan-name">
      <div className="billing-plan-summary">
        <p className="type-label billing-eyebrow">Current plan</p>
        <div className="billing-plan-identity">
          <h3 id="billing-plan-name">{plan.name}</h3>
          {standing.badge ? <StatusBadge tone={standing.badge.tone} label={standing.badge.label} /> : null}
        </div>
        {plan.description ? <p className="billing-plan-tagline">{plan.description}</p> : null}

        <p className="billing-plan-price">
          {complimentary ? (
            <strong>No charge</strong>
          ) : (
            <>
              <strong>{formatPrice(price, plan.currency)}</strong>
              <span>/ {periodWord(interval)}</span>
            </>
          )}
        </p>
        <p className="billing-plan-line">{standing.line}</p>

        {billing.viewer.can_change_plan ? (
          <div className="billing-plan-actions">
            <Button variant={actionLeads ? "secondary" : "primary"} onClick={onChangePlan}>
              Change plan
            </Button>
          </div>
        ) : (
          <p className="billing-plan-permission">Only a Portfolio owner or administrator can change the plan.</p>
        )}
      </div>

      <Usage billing={billing} catalogue={catalogue} standing={standing} />

      {standing.attention ? (
        <div className="billing-attention" data-tone={standing.attention.tone}>
          <div className="billing-attention-copy">
            <p className="billing-attention-title">{standing.attention.title}</p>
            {standing.attention.body ? <p className="billing-attention-body">{standing.attention.body}</p> : null}
          </div>
          {standing.attention.action ? (
            <AttentionButton
              action={standing.attention.action}
              busy={busyAction === standing.attention.action.kind}
              onAction={onAction}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function AttentionButton({
  action,
  busy,
  onAction,
}: {
  action: StandingAction;
  busy: boolean;
  onAction: (action: StandingAction) => void;
}) {
  return (
    <Button
      variant={action.kind === "keep" ? "secondary" : "primary"}
      busy={busy}
      busyLabel={action.kind === "keep" ? "Keeping…" : "Opening…"}
      onClick={() => onAction(action)}
    >
      {action.label}
    </Button>
  );
}

function Usage({
  billing,
  catalogue,
  standing,
}: {
  billing: PortfolioBilling;
  catalogue: PlanCatalogue;
  standing: Standing;
}) {
  const meters = metersOf(billing, catalogue);
  const note =
    standing.limitsNote ??
    (billing.over_limit.length
      ? "Nothing has been removed. Adding more pauses until you are back within your plan."
      : null);
  return (
    <div className="billing-usage" aria-labelledby="billing-usage-title">
      <h4 id="billing-usage-title" className="type-label billing-eyebrow">
        Usage
      </h4>
      <ul className="billing-meters">
        {meters.map((meter) => (
          <UsageMeter key={meter.key} meter={meter} />
        ))}
      </ul>
      {note ? <p className="billing-usage-note">{note}</p> : null}
    </div>
  );
}

function UsageMeter({ meter }: { meter: Meter }) {
  return (
    <li className="billing-meter" data-state={meter.state}>
      <div className="billing-meter-head">
        <span className="billing-meter-name">{meter.name}</span>
        <span className="billing-meter-count" aria-hidden="true">
          {meter.used.toLocaleString("en-GB")}
          <span>{meter.limit === null ? "" : ` / ${meter.limit.toLocaleString("en-GB")}`}</span>
        </span>
        <span className="sr-only">{meter.valueText}</span>
      </div>
      {/* The bar only reinforces the numbers beside it, so it is not read out. */}
      <div className="billing-meter-track" aria-hidden="true">
        <span className="billing-meter-fill" style={{ "--fill": meter.fill } as CSSProperties} />
      </div>
      <p className="billing-meter-note">{meter.note}</p>
    </li>
  );
}

export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="billing-badge" data-tone={tone}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}
