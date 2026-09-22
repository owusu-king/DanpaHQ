import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import {
  getPlanCatalogue,
  getPortfolioBilling,
  keepCurrentPlan,
  reactivateResources,
  type PlanCatalogue,
  type PortfolioBilling,
  type RestrictedResource,
} from "@/billing";
import type { StandingAction } from "@/billingPresentation";
import { IndexGround } from "@/components/account/IndexRows";
import { BillingRecords } from "@/components/billing/BillingRecords";
import { BillingPageSkeleton } from "@/components/billing/BillingSurfaces";
import { CurrentPlanCard } from "@/components/billing/CurrentPlanCard";
import { RestrictedResources } from "@/components/billing/RestrictedResources";
import { useHomeDensity } from "@/components/home/plinth";
import { EmptyState, GroupLabel, InfoNote, KOLA, QuietAction } from "@/components/portfolio/PortfolioList";
import { Notice, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import { listOrganizations, type Organization } from "@/organizations";

type Screen =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "forbidden"; organization: Organization }
  | { status: "ready"; organization: Organization; billing: PortfolioBilling; catalogue: PlanCatalogue };

type Feedback = { tone: "success" | "error"; title: string; body?: string };

/**
 * Plan & billing on a phone: one Portfolio's plan, usage and payments to Rooomly.
 *
 * Refined on review (2026-09-15). The plan leads, in one glass surface with its
 * usage; anything held above the plan's limits comes next, with the way back; how
 * the plan is billed and what has been paid follow. Nothing long is laid out at
 * once — each list shows its latest few and opens the rest in a sheet. Changing
 * plan is its own short journey — choose, review, pay — so the back gesture
 * always means one step.
 *
 * Everything shown comes from the server, and is read again whenever this
 * screen comes back into view rather than trusting what a later step sent.
 */
export default function BillingScreen() {
  const pageBottom = useSafeBottom(space[12]);
  const router = useRouter();
  const density = useHomeDensity();
  const [screen, setScreen] = useState<Screen>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<StandingAction["kind"] | null>(null);
  const [reactivating, setReactivating] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const load = useCallback(async () => {
    let organization: Organization | undefined;
    try {
      const organizations = await listOrganizations();
      organization = organizations[0];
      if (!organization) {
        setScreen({ status: "empty" });
        return;
      }
      const chosen = organization;
      const [catalogue, billing] = await Promise.all([getPlanCatalogue(), getPortfolioBilling(chosen.id)]);
      setScreen({ status: "ready", organization: chosen, billing, catalogue });
    } catch (cause) {
      if (organization && cause instanceof ApiFailure && cause.status === 403) {
        setScreen({ status: "forbidden", organization });
        return;
      }
      const message = cause instanceof ApiFailure ? cause.error.message : "Check your connection and try again.";
      // A refresh that fails keeps what the screen last knew.
      setScreen((current) => (current.status === "ready" ? current : { status: "error", message }));
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Read again whenever the screen comes back into view: a plan changed, a
  // payment confirmed or a choice applied on the steps after it.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const ready = screen.status === "ready" ? screen : null;

  async function act(action: StandingAction) {
    if (!ready) return;
    const { billing, organization } = ready;
    const subscription = billing.subscription;
    setFeedback(null);
    if (action.kind === "continue_payment" && billing.checkout.open) {
      router.push({
        pathname: "/(app)/billing-payment",
        params: { organizationId: organization.id, checkoutId: billing.checkout.open.id },
      } as never);
    } else if (action.kind === "renew" && subscription) {
      router.push({
        pathname: "/(app)/billing-review",
        params: { organizationId: organization.id, plan: subscription.plan.code, interval: subscription.billing_interval },
      } as never);
    } else if (action.kind === "keep") {
      setBusyAction("keep");
      try {
        const next = await keepCurrentPlan(organization.id);
        setScreen({ ...ready, billing: next });
        setFeedback({ tone: "success", title: `You're keeping ${next.subscription?.plan.name ?? "your plan"}` });
      } catch (cause) {
        setFeedback({
          tone: "error",
          title: "Your plan was not changed",
          body: cause instanceof ApiFailure ? cause.error.message : "Check your connection and try again.",
        });
      } finally {
        setBusyAction(null);
      }
    }
  }

  async function reactivate(resource: RestrictedResource) {
    if (!ready) return;
    setReactivating(resource.id);
    setFeedback(null);
    try {
      // The server decides whether there is room; the screen only says what it asked.
      const next = await reactivateResources(
        ready.organization.id,
        resource.kind === "property" ? { property_ids: [resource.id] } : { unit_ids: [resource.id] },
      );
      setScreen({ ...ready, billing: next });
      setFeedback({ tone: "success", title: `${resource.name} is fully active again` });
    } catch (cause) {
      setFeedback({
        tone: "error",
        title: `${resource.name} is still restricted`,
        body: cause instanceof ApiFailure ? cause.error.message : "Check your connection and try again.",
      });
      void load();
    } finally {
      setReactivating(null);
    }
  }

  const organization = screen.status === "ready" || screen.status === "forbidden" ? screen.organization : null;

  return (
    <IndexGround>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: density.pagePadding,
          paddingTop: density.compact ? space[4] : space[5],
          paddingBottom: pageBottom,
          gap: density.sectionGap + space[2],
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={KOLA}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
      >
        {organization ? <GroupLabel>{organization.name}</GroupLabel> : null}
        {feedback ? <Notice tone={feedback.tone} title={feedback.title} body={feedback.body} /> : null}

        {screen.status === "loading" ? <BillingPageSkeleton /> : null}

        {screen.status === "error" ? (
          <View style={styles.error}>
            <Notice tone="error" title="Plan & billing didn't load" body={screen.message} />
            <QuietAction icon="refresh" label="Try again" onPress={() => void load()} />
          </View>
        ) : null}

        {screen.status === "forbidden" ? (
          <InfoNote
            tone="lagoon"
            icon="lock-closed-outline"
            title="Plan & billing is kept to the Portfolio's owner, administrators and accountants"
            body="Ask the Portfolio owner if you need to know what this Portfolio is on."
          />
        ) : null}

        {screen.status === "empty" ? (
          <EmptyState
            hero
            icon="briefcase-outline"
            title="No Portfolio yet"
            hint="A plan belongs to a Portfolio. Create one and it starts on Free."
          />
        ) : null}

        {ready ? (
          <>
            <CurrentPlanCard
              billing={ready.billing}
              catalogue={ready.catalogue}
              busyAction={busyAction}
              onChangePlan={() =>
                router.push({ pathname: "/(app)/billing-plans", params: { organizationId: ready.organization.id } } as never)
              }
              onAction={(action) => void act(action)}
            />
            <RestrictedResources
              billing={ready.billing}
              busyId={reactivating}
              onReactivate={(resource) => void reactivate(resource)}
            />
            <BillingRecords
              billing={ready.billing}
              catalogue={ready.catalogue}
              onPayEarly={() => void act({ kind: "renew", label: "" })}
            />
          </>
        ) : null}
      </ScrollView>
    </IndexGround>
  );
}

const styles = StyleSheet.create({
  error: {
    gap: space[3],
  },
});
