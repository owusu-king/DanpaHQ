"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { LoadingRows } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import {
  getPlanCatalogue,
  getPortfolioBilling,
  listOrganizations,
  type EntitlementMeta,
  type EntitlementValue,
  type Organization,
  type PlanCatalogue,
  type PlanSummary,
  type PortfolioBilling,
} from "@/lib/console";
import { useSession } from "@/lib/session";

/**
 * Plan & billing.
 *
 * A provider opens this to answer one question — "can I add another property"
 * — so the meters are the top of the page and the plan ladder sits under them.
 * Shopping is the secondary job.
 *
 * Nothing on this page decides anything. Every limit shown is checked again on
 * the server inside the transaction that takes the slot; this renders the same
 * numbers the backend enforces with, and if the two ever disagree the server is
 * right. Names and grouping come from the catalogue rather than from constants
 * here, so moving a capability between plans stays a backend change.
 *
 * There is no checkout. Paid plans are not live, and a button that took money
 * before the payment path was finished is the one thing this whole architecture
 * has been careful not to build.
 */
export default function BillingPage() {
  const { state, activeContext } = useSession();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [billing, setBilling] = useState<PortfolioBilling | null>(null);
  const [catalogue, setCatalogue] = useState<PlanCatalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  // Set only when this page's own switcher is used. Until then the session's
  // active Portfolio decides, so arriving here shows the one you were just in.
  const [picked, setPicked] = useState<string | null>(null);

  const sessionId = activeContext?.startsWith("organization:")
    ? activeContext.slice("organization:".length)
    : "";
  const activeId = picked ?? sessionId;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const orgs = await listOrganizations();
      setOrganizations(orgs);
      const target = orgs.find((row) => row.id === activeId) ?? orgs[0] ?? null;
      setOrganization(target);
      if (!target) {
        setBilling(null);
        return;
      }
      // The catalogue is public and the same for everybody; the snapshot is
      // this Portfolio's own. Fetched together so the page renders once.
      const [plans, snapshot] = await Promise.all([
        getPlanCatalogue(),
        getPortfolioBilling(target.id),
      ]);
      setCatalogue(plans);
      setBilling(snapshot);
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not load this Portfolio's plan.",
      );
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const meters = useMemo(() => {
    if (!billing || !catalogue) return [];
    return catalogue.headline_limits.map((key) => {
      const meta = catalogue.entitlements.find((item) => item.key === key);
      const limit = billing.limits[key] ?? null;
      const used = billing.usage[USAGE_FOR[key] ?? ""] ?? 0;
      return { key, name: meta?.name ?? key, used, limit };
    });
  }, [billing, catalogue]);

  if (state.status !== "signed_in") return <LoadingRows rows={4} />;
  if (loading && !billing) {
    return (
      <div className="billing-workspace">
        <section className="settings-section">
          <h2>Plan &amp; billing</h2>
        </section>
        <LoadingRows rows={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="billing-workspace">
        <Notice tone="warning" title="Could not load this" body={error} />
      </div>
    );
  }

  if (!organization || !billing || !catalogue) {
    return (
      <div className="billing-workspace">
        <Notice
          tone="info"
          title="No Portfolio yet"
          body="A plan belongs to a property business, not to your account. Create a Portfolio and it starts on Free."
        />
      </div>
    );
  }

  const plan = billing.plan;
  const canManage =
    organization.current_user_role === "owner" || organization.current_user_role === "admin";
  const cheaperFirst = catalogue.plans;
  const currentIndex = catalogue.upgrade_order.indexOf(plan.code);
  const selected = cheaperFirst.find((row) => row.code === chosen) ?? null;

  return (
    <div className="billing-workspace">
      <div className="billing-head">
        <div>
          <h2>Plan &amp; billing</h2>
          <p className="type-caption">
            {organization.name} is on a plan. Everyone you invite works inside it — a plan belongs
            to the business, not to a person.
          </p>
        </div>
        <span className="billing-plan-badge" data-plan={plan.code}>
          {plan.name}
        </span>
      </div>

      {organizations.length > 1 ? (
        <div className="team-portfolio-switch">
          <Select
            label="Portfolio"
            value={organization.id}
            onChange={(value) => {
              setChosen(null);
              setPicked(value);
            }}
            options={organizations.map((row) => [row.id, row.name] as const)}
          />
        </div>
      ) : null}

      {billing.over_limit.length ? (
        <Notice
          tone="warning"
          title="This Portfolio holds more than its plan includes"
          body={`${describeOver(billing.over_limit, catalogue.entitlements)} Nothing has been removed and nothing will be — everything stays readable, editable and lettable. What changes is that you cannot add more until you move to a larger plan.`}
        />
      ) : null}

      <section className="settings-section">
        <h3 className="type-label">WHAT YOU ARE USING</h3>
        <dl className="billing-meters">
          {meters.map((meter) => {
            const fill = meterState(meter.used, meter.limit);
            return (
              <div className="billing-meter" key={meter.key} data-state={fill}>
                <dt>{meter.name}</dt>
                <dd className="billing-meter-count">
                  {meter.used}
                  <span className="billing-meter-of">
                    {" "}
                    of {meter.limit === null ? "unlimited" : meter.limit}
                  </span>
                </dd>
                <div
                  className="billing-bar"
                  role="img"
                  aria-label={`${meter.used} of ${meter.limit === null ? "unlimited" : meter.limit}`}
                >
                  <span style={{ width: `${barWidth(meter.used, meter.limit)}%` }} />
                </div>
                <p className="billing-meter-note">{meterNote(meter.used, meter.limit)}</p>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="settings-section">
        <h3 className="type-label">PLANS</h3>
        <ul className="billing-plans">
          {cheaperFirst.map((row) => {
            const isCurrent = row.code === plan.code;
            const rank = catalogue.upgrade_order.indexOf(row.code);
            return (
              <li className="billing-plan" key={row.code} data-current={isCurrent}>
                <h4>{row.name}</h4>
                <p className="billing-plan-price">
                  {formatMoney(row.monthly_price_minor, row.currency)}
                  {row.monthly_price_minor > 0 ? <small> /month</small> : null}
                </p>
                <p className="billing-plan-description">{row.description}</p>
                {isCurrent ? (
                  <p className="billing-plan-current">Your current plan</p>
                ) : rank > currentIndex ? (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setChosen(row.code)}
                    disabled={!canManage}
                  >
                    Upgrade to {row.name}
                  </button>
                ) : null}
                {!canManage && rank > currentIndex ? (
                  <p className="type-caption">Only an owner or administrator can change the plan.</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {selected ? (
        <Notice
          tone="info"
          title={`${selected.name} is not available to buy yet`}
          body="Paid plans are still being finished. Nothing has been charged and your plan has not changed. We will let you know the moment they open."
        />
      ) : null}

      <section className="settings-section">
        <h3 className="type-label">WHAT EACH PLAN INCLUDES</h3>
        <div className="billing-compare">
          <table>
            <caption>
              Every limit here is checked on the server when you create something, not in this page.
            </caption>
            <thead>
              <tr>
                <th scope="col">Included</th>
                {cheaperFirst.map((row) => (
                  <th scope="col" key={row.code}>
                    {row.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalogue.groups.map((group) => (
                <Group
                  key={group}
                  group={group}
                  entitlements={catalogue.entitlements.filter((item) => item.group === group)}
                  plans={cheaperFirst}
                  currentCode={plan.code}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="type-caption">
        Moving to a smaller plan never deletes properties, tenants, leases or payment records.
      </p>
    </div>
  );
}

function Group({
  group,
  entitlements,
  plans,
  currentCode,
}: {
  group: string;
  entitlements: EntitlementMeta[];
  plans: PlanSummary[];
  currentCode: string;
}) {
  if (!entitlements.length) return null;
  return (
    <>
      <tr className="billing-group-row">
        <th scope="colgroup" colSpan={plans.length + 1}>
          {group}
        </th>
      </tr>
      {entitlements.map((item) => (
        <tr key={item.key}>
          <th scope="row">
            {item.name}
            {item.description ? <span>{item.description}</span> : null}
          </th>
          {plans.map((row) => (
            <td key={row.code} data-current={row.code === currentCode}>
              {renderValue(row.entitlements[item.key], item.value_type)}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Which live count answers which limit. */
const USAGE_FOR: Record<string, string> = {
  PROPERTY_LIMIT: "PROPERTY_COUNT",
  UNIT_LIMIT: "UNIT_COUNT",
  TEAM_MEMBER_LIMIT: "TEAM_MEMBER_COUNT",
};

function renderValue(value: EntitlementValue | undefined, type: EntitlementMeta["value_type"]) {
  if (!value) return <span className="billing-no">—</span>;
  // Unlimited is a flag, never a large number. Printing "999999 properties"
  // would tell somebody something false about the product.
  if (value.unlimited) return <span className="billing-yes">Unlimited</span>;
  if (type === "boolean") {
    return value.value ? (
      <span className="billing-yes">Included</span>
    ) : (
      <span className="billing-no">—</span>
    );
  }
  return <>{value.value ?? <span className="billing-no">—</span>}</>;
}

function meterState(used: number, limit: number | null): "ok" | "near" | "over" {
  if (limit === null) return "ok";
  if (used > limit) return "over";
  if (limit > 0 && used / limit >= 0.8) return "near";
  return "ok";
}

function barWidth(used: number, limit: number | null): number {
  if (limit === null || limit <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function meterNote(used: number, limit: number | null): string {
  if (limit === null) return "No limit on your plan.";
  if (used > limit) return `${used - limit} over what this plan includes.`;
  const left = limit - used;
  if (left === 0) return "You have used all of these.";
  return `${left} left.`;
}

function describeOver(
  rows: PortfolioBilling["over_limit"],
  entitlements: EntitlementMeta[],
): string {
  return rows
    .map((row) => {
      const name = entitlements.find((item) => item.key === row.entitlement)?.name ?? row.entitlement;
      return `${name}: ${row.current} against a limit of ${row.limit}.`;
    })
    .join(" ");
}

function formatMoney(minor: number, currency: string): string {
  if (minor === 0) return "Free";
  const major = minor / 100;
  return `${currency === "GHS" ? "GH₵" : currency} ${major.toLocaleString("en-GH", {
    minimumFractionDigits: major % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
