"use client";

import { useCallback, useEffect, useState } from "react";

import { BillingRecords } from "@/components/billing/BillingRecords";
import { CurrentPlan } from "@/components/billing/CurrentPlan";
import { PlanChangeDialog, type PlanChangeStart } from "@/components/billing/PlanChangeDialog";
import { RestrictedResources } from "@/components/billing/RestrictedResources";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { useToast } from "@/components/toast/Toaster";
import { ApiFailure } from "@/lib/api";
import {
  getPlanCatalogue,
  getPortfolioBilling,
  keepCurrentPlan,
  reactivateResources,
  type PlanCatalogue,
  type PortfolioBilling,
  type RestrictedResource,
} from "@/lib/billing";
import type { StandingAction } from "@/lib/billingPresentation";
import { listOrganizations, type Organization } from "@/lib/console";
import { useSession } from "@/lib/session";

type View =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "forbidden"; organization: Organization }
  | { status: "ready"; organization: Organization; billing: PortfolioBilling; catalogue: PlanCatalogue };

/**
 * Plan & billing: one Portfolio's plan, usage and payments to Danpa HQ.
 *
 * Glance → understand → act. The plan, its price, how long it is paid for and
 * how much of it is in use lead the page; anything held above the plan's limits
 * comes next, with the way back; how it is billed and what has been paid sit
 * quietly under it; the three-plan comparison lives inside Change plan rather
 * than on the page.
 *
 * Everything shown comes from the server — the catalogue, this Portfolio's
 * billing read, and what the signed-in person may do with it — and the page
 * reads it again after every change rather than trusting what it sent.
 */
export default function BillingPage() {
  const { state, activeContext } = useSession();
  const { toast } = useToast();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<View>({ status: "loading" });
  const [dialog, setDialog] = useState<PlanChangeStart | null>(null);
  const [busyAction, setBusyAction] = useState<StandingAction["kind"] | null>(null);
  const [reactivating, setReactivating] = useState<string | null>(null);

  const sessionId = activeContext?.startsWith("organization:") ? activeContext.slice("organization:".length) : "";
  const wanted = picked ?? sessionId;
  const signedIn = state.status === "signed_in";

  const load = useCallback(async () => {
    let organization: Organization | undefined;
    try {
      const rows = await listOrganizations();
      setOrganizations(rows);
      organization = rows.find((row) => row.id === wanted) ?? rows[0];
      if (!organization) {
        setView({ status: "empty" });
        return;
      }
      const chosen = organization;
      setView((current) =>
        current.status === "ready" && current.organization.id === chosen.id ? current : { status: "loading" },
      );
      const [catalogue, billing] = await Promise.all([getPlanCatalogue(), getPortfolioBilling(chosen.id)]);
      setView({ status: "ready", organization: chosen, billing, catalogue });
    } catch (cause) {
      if (organization && cause instanceof ApiFailure && cause.status === 403) {
        setView({ status: "forbidden", organization });
        return;
      }
      const message = cause instanceof ApiFailure ? cause.error.message : "Check your connection and try again.";
      setView((current) => (current.status === "ready" ? current : { status: "error", message }));
    }
  }, [wanted]);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  const organizationId = view.status === "ready" ? view.organization.id : null;

  /** Take the server's answer when there is one; otherwise read it again. */
  const changed = useCallback(
    async (next?: PortfolioBilling) => {
      if (!organizationId) return;
      if (next) {
        setView((current) => (current.status === "ready" ? { ...current, billing: next } : current));
        return;
      }
      try {
        const billing = await getPortfolioBilling(organizationId);
        setView((current) =>
          current.status === "ready" && current.organization.id === organizationId ? { ...current, billing } : current,
        );
      } catch {
        // The page keeps what it last knew; the next read corrects it.
      }
    },
    [organizationId],
  );

  const act = useCallback(
    async (action: StandingAction) => {
      if (view.status !== "ready") return;
      const { billing, organization } = view;
      const subscription = billing.subscription;
      if (action.kind === "continue_payment" && billing.checkout.open) {
        setDialog({ step: "payment", checkout: billing.checkout.open });
      } else if (action.kind === "renew" && subscription) {
        setDialog({ step: "review", plan: subscription.plan.code, interval: subscription.billing_interval });
      } else if (action.kind === "keep") {
        setBusyAction("keep");
        try {
          const next = await keepCurrentPlan(organization.id);
          await changed(next);
          toast({ tone: "success", title: `You're keeping ${next.subscription?.plan.name ?? "your plan"}` });
        } catch (cause) {
          toast({
            tone: "error",
            title: "Your plan was not changed",
            description: cause instanceof ApiFailure ? cause.error.message : "Check your connection and try again.",
          });
        } finally {
          setBusyAction(null);
        }
      }
    },
    [view, changed, toast],
  );

  const reactivate = useCallback(
    async (resource: RestrictedResource) => {
      if (view.status !== "ready") return;
      setReactivating(resource.id);
      try {
        // The server decides whether there is room; the page only says what it asked.
        const next = await reactivateResources(
          view.organization.id,
          resource.kind === "property" ? { property_ids: [resource.id] } : { unit_ids: [resource.id] },
        );
        await changed(next);
        toast({ tone: "success", title: `${resource.name} is fully active again` });
      } catch (cause) {
        toast({
          tone: "error",
          title: `${resource.name} is still restricted`,
          description: cause instanceof ApiFailure ? cause.error.message : "Check your connection and try again.",
        });
        void changed();
      } finally {
        setReactivating(null);
      }
    },
    [view, changed, toast],
  );

  if (!signedIn || view.status === "loading") return <BillingSkeleton />;

  const organization = view.status === "ready" || view.status === "forbidden" ? view.organization : null;

  return (
    <div className="billing-page">
      <header className="billing-page-head">
        <div>
          <h2>Plan &amp; billing</h2>
          {organization ? <p>{organization.name}</p> : null}
        </div>
        {organizations.length > 1 && organization ? (
          <div className="billing-portfolio-switch">
            <Select
              label="Portfolio"
              value={organization.id}
              onChange={(value) => {
                setDialog(null);
                setPicked(value);
              }}
              options={organizations.map((row) => [row.id, row.name] as const)}
            />
          </div>
        ) : null}
      </header>

      {view.status === "error" ? (
        <div className="billing-state">
          <Notice tone="error" title="Plan & billing didn't load" body={view.message} />
          <Button variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : null}

      {view.status === "forbidden" ? (
        <Notice
          tone="info"
          title="Plan & billing is kept to the Portfolio's owner, administrators and accountants"
          body="Ask the Portfolio owner if you need to know what this Portfolio is on."
        />
      ) : null}

      {view.status === "empty" ? (
        <Notice tone="info" title="No Portfolio yet" body="A plan belongs to a Portfolio. Create one and it starts on Free." />
      ) : null}

      {view.status === "ready" ? (
        <>
          <CurrentPlan
            billing={view.billing}
            catalogue={view.catalogue}
            busyAction={busyAction}
            onChangePlan={() => setDialog({ step: "compare" })}
            onAction={(action) => void act(action)}
          />
          <RestrictedResources
            billing={view.billing}
            busyId={reactivating}
            onReactivate={(resource) => void reactivate(resource)}
          />
          <BillingRecords
            billing={view.billing}
            catalogue={view.catalogue}
            onPayEarly={() => void act({ kind: "renew", label: "" })}
          />
          <PlanChangeDialog
            open={dialog !== null}
            start={dialog ?? { step: "compare" }}
            organizationId={view.organization.id}
            billing={view.billing}
            catalogue={view.catalogue}
            onClose={() => setDialog(null)}
            onChanged={changed}
          />
        </>
      ) : null}
    </div>
  );
}

function BillingSkeleton() {
  return (
    <div className="billing-page" aria-busy="true" aria-label="Loading Plan and billing">
      <div className="billing-page-head" aria-hidden="true">
        <div className="billing-skeleton-stack">
          <span className="skeleton billing-skeleton-title" />
          <span className="skeleton billing-skeleton-line billing-skeleton-short" />
        </div>
      </div>
      <div className="billing-plan" aria-hidden="true">
        <div className="billing-plan-summary">
          <span className="skeleton billing-skeleton-line billing-skeleton-short" />
          <span className="skeleton billing-skeleton-name" />
          <span className="skeleton billing-skeleton-line" />
          <span className="skeleton billing-skeleton-price" />
          <span className="skeleton billing-skeleton-button" />
        </div>
        <div className="billing-usage">
          {[0, 1, 2].map((row) => (
            <div key={row} className="billing-skeleton-stack">
              <span className="skeleton billing-skeleton-line" />
              <span className="skeleton billing-skeleton-bar" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
