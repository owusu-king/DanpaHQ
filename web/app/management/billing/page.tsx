"use client";

import { useState } from "react";

import {
  DataTable,
  Empty,
  Feedback,
  PageHeader,
  Panel,
  ResourceState,
  Status,
  useResource,
} from "@/components/management/ManagementUI";
import {
  ManagementFailure,
  formatDate,
  managementFetch,
  managementIdempotentMutation,
  useManagement,
} from "@/lib/management";

type Usage = Record<string, number>;

type PortfolioRow = {
  id: string;
  name: string;
  organization_type: string;
  plan_code: string;
  plan_name: string;
  status: string;
  cancel_at_period_end: boolean;
  usage: Usage;
  limits: Record<string, number | null>;
  over_limit: Array<{ entitlement: string; current: number; limit: number }>;
};

type BillingEvent = {
  id: string;
  event_type: string;
  from_plan_code: string;
  to_plan_code: string;
  from_status: string;
  to_status: string;
  reason: string;
  actor_label: string;
  occurred_at: string;
};

type PortfolioDetail = {
  portfolio: { id: string; name: string };
  billing: {
    plan: { code: string; name: string };
    subscription: { status: string; current_period_end: string | null } | null;
    usage: Usage;
    limits: Record<string, number | null>;
    over_limit: Array<{ entitlement: string; current: number; limit: number }>;
    entitlements: Record<string, { value: number | boolean | null; unlimited: boolean; source: string }>;
  };
  events: BillingEvent[];
};

const PLANS = ["FREE", "PRO", "BUSINESS"];

/**
 * Billing operations.
 *
 * Support's first billing question is "why can't this customer add a property",
 * and the answer is almost always a limit — so plan and live usage sit in the
 * same row and nobody has to open a shell to find out.
 *
 * Changing a plan here is an administrative grant, never a sale. It writes the
 * same billing event and audit record as any other plan change, stamped with
 * the staff member who did it, and a reason is required: "somebody changed this
 * and nobody knows why" is the failure this screen exists to prevent.
 */
export default function ManagementBillingPage() {
  const { can } = useManagement();
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState("");
  const path = `/billing/${buildQuery(query, plan)}`;
  const { data, loading, error, reload } = useResource<{ results: PortfolioRow[] }>(path);
  const [openId, setOpenId] = useState<string | null>(null);

  // Reading is support work; changing what somebody pays for is a separate
  // grant, and the server enforces the same split.
  const mayManage = can("manage_billing");
  const rows = data?.results ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Commercial"
        title="Billing"
        description="What each Portfolio is on, what it is actually using, and where it sits over its plan. Downgrading never removes a customer's properties, tenants or records."
      />

      <Panel title="Portfolios" meta={`${rows.length} shown`}>
        <div className="management-form">
          <label>
            <span>Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Portfolio name"
            />
          </label>
          <label>
            <span>Plan</span>
            <select value={plan} onChange={(event) => setPlan(event.target.value)}>
              <option value="">Any</option>
              {PLANS.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        </div>

        <ResourceState loading={loading} error={error} />
        {!loading && !error && rows.length === 0 ? <Empty message="No Portfolios match." /> : null}

        {rows.length ? (
          <DataTable label="Portfolios and their plans">
            <thead>
              <tr>
                <th>Portfolio</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Properties</th>
                <th>Units</th>
                <th>Team</th>
                <th>Over limit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.plan_code || "—"}</td>
                  <td>
                    <Status value={row.status || null} />
                  </td>
                  <td>{meter(row, "PROPERTY_COUNT", "PROPERTY_LIMIT")}</td>
                  <td>{meter(row, "UNIT_COUNT", "UNIT_LIMIT")}</td>
                  <td>{meter(row, "TEAM_MEMBER_COUNT", "TEAM_MEMBER_LIMIT")}</td>
                  <td>
                    {row.over_limit.length ? (
                      <span className="management-status warning">
                        {row.over_limit.map((item) => label(item.entitlement)).join(", ")}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="management-button"
                      onClick={() => setOpenId(openId === row.id ? null : row.id)}
                    >
                      {openId === row.id ? "Close" : "Open"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : null}
      </Panel>

      {openId ? (
        <PortfolioPanel
          portfolioId={openId}
          mayManage={mayManage}
          onChanged={() => {
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function PortfolioPanel({
  portfolioId,
  mayManage,
  onChanged,
}: {
  portfolioId: string;
  mayManage: boolean;
  onChanged: () => void;
}) {
  const { data, loading, error, reload } = useResource<PortfolioDetail>(`/billing/${portfolioId}/`);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [done, setDone] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure("");
    setDone("");
    try {
      await managementFetch(`/billing/${portfolioId}/plan/`, {
        method: "POST",
        body: JSON.stringify({ plan_code: target, reason }),
        ...managementIdempotentMutation(),
      });
      setDone(`Moved to ${target}.`);
      setReason("");
      setTarget("");
      reload();
      onChanged();
    } catch (cause) {
      setFailure(cause instanceof ManagementFailure ? cause.message : "Could not change the plan.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || error) {
    return (
      <Panel title="Portfolio">
        <ResourceState loading={loading} error={error} />
      </Panel>
    );
  }
  if (!data) return null;

  const { billing, events } = data;

  return (
    <>
      <Panel title={data.portfolio.name} meta={billing.plan.name}>
        <dl className="management-grid">
          <div>
            <dt>Plan</dt>
            <dd>{billing.plan.code}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <Status value={billing.subscription?.status ?? null} />
            </dd>
          </div>
          <div>
            <dt>Renews</dt>
            <dd>
              {billing.subscription?.current_period_end
                ? formatDate(billing.subscription.current_period_end)
                : "—"}
            </dd>
          </div>
        </dl>

        {billing.over_limit.length ? (
          <Feedback
            error={`Over plan: ${billing.over_limit
              .map((item) => `${label(item.entitlement)} ${item.current} of ${item.limit}`)
              .join(", ")}. Nothing has been removed — only new creation is blocked.`}
          />
        ) : null}

        {mayManage ? (
          <form className="management-form" onSubmit={submit}>
            <label>
              <span>Move to</span>
              <select value={target} onChange={(event) => setTarget(event.target.value)} required>
                <option value="">Choose a plan</option>
                {PLANS.filter((code) => code !== billing.plan.code).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Reason</span>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why this is changing"
                required
              />
            </label>
            <div className="management-form-actions">
              <button
                type="submit"
                className="management-button primary"
                disabled={busy || !target || !reason.trim()}
              >
                {busy ? "Changing…" : "Change plan"}
              </button>
            </div>
            <p className="management-subtext">
              An administrative grant, not a sale. It is recorded against your account with the
              reason you give, and it never removes anything the customer holds.
            </p>
          </form>
        ) : (
          <p className="management-subtext">
            You can read this Portfolio&apos;s plan. Changing it needs the billing permission.
          </p>
        )}
        <Feedback error={failure} success={done} />
      </Panel>

      <Panel title="Plan history" meta={`${events.length} events`}>
        {events.length === 0 ? (
          <Empty message="Nothing recorded yet." />
        ) : (
          <DataTable label="Billing events">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>From</th>
                <th>To</th>
                <th>By</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDate(event.occurred_at)}</td>
                  <td>{event.event_type.replaceAll("_", " ")}</td>
                  <td>{event.from_plan_code || "—"}</td>
                  <td>{event.to_plan_code || "—"}</td>
                  <td>{event.actor_label}</td>
                  <td>{event.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>
    </>
  );
}

function buildQuery(query: string, plan: string): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (plan) params.set("plan", plan);
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

function meter(row: PortfolioRow, countKey: string, limitKey: string): string {
  const used = row.usage[countKey] ?? 0;
  const ceiling = row.limits[limitKey];
  // Unlimited is a flag on the plan, so it prints as a word here too rather
  // than as whatever large number somebody might have been tempted to store.
  return `${used} / ${ceiling === null || ceiling === undefined ? "∞" : ceiling}`;
}

function label(entitlement: string): string {
  return entitlement.replace("_LIMIT", "").replaceAll("_", " ").toLowerCase();
}
