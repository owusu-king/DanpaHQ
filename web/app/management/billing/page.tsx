"use client";

import { useState } from "react";

import {
  DataTable,
  Drawer,
  Empty,
  Fact,
  Facts,
  Feedback,
  FilterTabs,
  PageHeader,
  Panel,
  ResourceState,
  SearchField,
  Section,
  Status,
  Toolbar,
  humanize,
  managementError,
  useDebounced,
  useNotice,
  useQueryState,
  useResource,
} from "@/components/management/ManagementUI";
import {
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

const METERS = [
  ["Properties", "PROPERTY_COUNT", "PROPERTY_LIMIT"],
  ["Units", "UNIT_COUNT", "UNIT_LIMIT"],
  ["Team", "TEAM_MEMBER_COUNT", "TEAM_MEMBER_LIMIT"],
] as const;

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
  const [query, setQuery] = useQueryState("q");
  const [plan, setPlan] = useQueryState("plan");
  const settledQuery = useDebounced(query);
  const path = `/billing/${buildQuery(settledQuery, plan)}`;
  const { data, loading, refreshing, error, reload } = useResource<{ results: PortfolioRow[] }>(path);
  const [openId, setOpenId] = useState<string | null>(null);

  // Reading is support work; changing what somebody pays for is a separate
  // grant, and the server enforces the same split.
  const mayManage = can("manage_billing");
  const rows = data?.results ?? [];

  return (
    <>
      <PageHeader
        title="Billing"
      />

      <Panel title="Portfolios" busy={refreshing} meta={data ? `${rows.length} shown` : undefined}>
        <Toolbar>
          <SearchField label="Search Portfolios" placeholder="Portfolio name" value={query} onChange={setQuery} />
          <FilterTabs
            label="Plan"
            value={plan}
            onChange={setPlan}
            options={[{ value: "", label: "Any plan" }, ...PLANS.map((code) => ({ value: code, label: humanize(code.toLowerCase()) }))]}
          />
        </Toolbar>

        <ResourceState loading={loading} error={error} onRetry={reload} />
        {data && !error && rows.length === 0 ? <Empty icon="portfolio" message="No Portfolios match." /> : null}

        {rows.length ? (
          <DataTable label="Portfolios and their plans">
            <thead>
              <tr>
                <th>Portfolio</th>
                <th>Plan</th>
                <th>Status</th>
                {METERS.map(([heading]) => <th key={heading}>{heading}</th>)}
                <th>Over limit</th>
                <th className="is-end"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong>{row.organization_type ? <span className="management-subtext">{humanize(row.organization_type)}</span> : null}</td>
                  <td>{row.plan_name || row.plan_code || "—"}{row.cancel_at_period_end ? <span className="management-subtext">Ends at period end</span> : null}</td>
                  <td>
                    <Status value={row.status || null} />
                  </td>
                  {METERS.map(([heading, countKey, limitKey]) => <td key={heading}>{meter(row, countKey, limitKey)}</td>)}
                  <td>
                    {row.over_limit.length ? (
                      <Status value="over" tone="warning" label={row.over_limit.map((item) => label(item.entitlement)).join(", ")} />
                    ) : (
                      <span className="management-subtext">Within plan</span>
                    )}
                  </td>
                  <td className="is-end">
                    <button type="button" className="management-button" onClick={() => setOpenId(row.id)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : null}
      </Panel>

      {openId ? (
        <PortfolioDrawer
          portfolioId={openId}
          mayManage={mayManage}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function PortfolioDrawer({
  portfolioId,
  mayManage,
  onClose,
  onChanged,
}: {
  portfolioId: string;
  mayManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const notify = useNotice();
  const { data, loading, error, reload } = useResource<PortfolioDetail>(`/billing/${portfolioId}/`);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure("");
    try {
      await managementFetch(`/billing/${portfolioId}/plan/`, {
        method: "POST",
        body: JSON.stringify({ plan_code: target, reason }),
        ...managementIdempotentMutation(),
      });
      notify("success", `${data?.portfolio.name ?? "Portfolio"} moved to ${target}.`);
      setReason("");
      setTarget("");
      reload();
      onChanged();
    } catch (cause) {
      setFailure(managementError(cause, "Could not change the plan."));
    } finally {
      setBusy(false);
    }
  }

  const billing = data?.billing;
  const events = data?.events ?? [];

  return (
    <Drawer
      wide
      title={data?.portfolio.name ?? "Portfolio"}
      meta={billing ? billing.plan.name : undefined}
      onClose={onClose}
      busy={busy}
      footer={mayManage && billing ? (
        <>
          <button
            type="submit"
            form="billing-plan-change"
            className="management-button primary"
            disabled={busy || !target || !reason.trim()}
          >
            {busy ? "Changing…" : "Change plan"}
          </button>
          <button type="button" className="management-button" disabled={busy} onClick={onClose}>Close</button>
        </>
      ) : undefined}
    >
      <ResourceState loading={loading && !data} error={error} onRetry={reload} />
      {billing ? (
        <>
          <Facts columns={3}>
            <Fact label="Plan">{billing.plan.code}</Fact>
            <Fact label="Status"><Status value={billing.subscription?.status ?? null} /></Fact>
            <Fact label="Renews">
              {billing.subscription?.current_period_end
                ? formatDate(billing.subscription.current_period_end)
                : "—"}
            </Fact>
            {METERS.map(([heading, countKey, limitKey]) => (
              <Fact key={heading} label={heading}>{usage(billing.usage, billing.limits, countKey, limitKey)}</Fact>
            ))}
          </Facts>

          {billing.over_limit.length ? (
            <Feedback
              error={`Over plan: ${billing.over_limit
                .map((item) => `${label(item.entitlement)} ${item.current} of ${item.limit}`)
                .join(", ")}. Nothing has been removed — only new creation is blocked.`}
            />
          ) : null}

          <Section title="Change plan">
            {mayManage ? (
              <form id="billing-plan-change" className="management-form" onSubmit={submit}>
                <div className="management-form-grid">
                  <label>
                    <span>Move to</span>
                    <select value={target} onChange={(event) => setTarget(event.target.value)} required disabled={busy}>
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
                      disabled={busy}
                    />
                  </label>
                </div>
                <p className="management-hint">
                  An administrative grant, not a sale. It is recorded against your account with the
                  reason you give, and it never removes anything the customer holds.
                </p>
                <Feedback error={failure} />
              </form>
            ) : (
              <p className="management-hint">
                You can read this Portfolio&apos;s plan. Changing it needs the billing permission.
              </p>
            )}
          </Section>

          <Section title="Plan history" aside={<span className="management-subtext">{events.length} events</span>}>
            {events.length === 0 ? (
              <p className="management-hint">Nothing recorded yet.</p>
            ) : (
              <ol className="management-history">
                {events.map((event) => (
                  <li key={event.id}>
                    <div>
                      <strong>{humanize(event.event_type)}</strong>
                      {event.from_plan_code && event.to_plan_code ? (
                        <span> · {event.from_plan_code} → {event.to_plan_code}</span>
                      ) : event.to_plan_code || event.from_plan_code ? (
                        <span> · {event.to_plan_code || event.from_plan_code}</span>
                      ) : null}
                    </div>
                    <span className="management-subtext">{formatDate(event.occurred_at)} · {event.actor_label}</span>
                    {event.reason ? <p>{event.reason}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </>
      ) : null}
    </Drawer>
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
  return usage(row.usage, row.limits, countKey, limitKey);
}

function usage(used: Usage, limits: Record<string, number | null>, countKey: string, limitKey: string): string {
  const ceiling = limits[limitKey];
  // Unlimited is a flag on the plan, so it prints as a word here too rather
  // than as whatever large number somebody might have been tempted to store.
  return `${used[countKey] ?? 0} / ${ceiling === null || ceiling === undefined ? "∞" : ceiling}`;
}

function label(entitlement: string): string {
  return entitlement.replace("_LIMIT", "").replaceAll("_", " ").toLowerCase();
}
