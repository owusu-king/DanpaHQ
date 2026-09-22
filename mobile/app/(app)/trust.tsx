import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth, type TrustEntry, type TrustState } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Panel } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  DEEP,
  GroupLabel,
  HARMATTAN,
  INK,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  MUTED,
  PRESSED,
  RULE,
  RowLine,
  rowStyles,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { Notice, Type, radius, space } from "@/components/ui";
import {
  getPayoutDestination,
  listOrganizations,
  type Organization,
  type PayoutDestinationState,
} from "@/organizations";
import { isAndroid, pressableFeedback, useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

type Verification = {
  id: string;
  kind: string;
  status: string;
  decision_note: string;
};

type TrustPayload = {
  summary: Record<string, TrustEntry>;
  verifications: Verification[];
};

type SettlementOverview = {
  organization: Organization | null;
  mayManage: boolean;
  destination: PayoutDestinationState | null;
};

/** One line of the page: what the check is, where it stands, and the way on when there is one. */
type Check = {
  key: string;
  icon: IconName;
  title: string;
  detail: string;
  state: TrustState;
  statusLabel?: string;
  actionLabel?: string;
  onPress?: () => void;
};

const RELEVANT_KINDS = {
  tenant: ["phone", "identity"],
  landlord: ["phone", "identity"],
  property_manager: ["phone", "identity"],
  agent: ["phone", "identity", "agency"],
} satisfies Record<string, string[]>;

const KIND_LABEL: Record<string, string> = {
  phone: "Phone number",
  identity: "Identity",
  agency: "Agent licence",
};

const KIND_ICON: Record<string, IconName> = {
  phone: "phone-portrait-outline",
  identity: "person-outline",
  agency: "briefcase-outline",
};

/**
 * What Rooomly has confirmed, and what still needs you.
 *
 * A status overview; the work itself continues on focused, resumable screens.
 *
 * Refined on review (2026-09-15): how far the checks have got leads as a ring, with
 * the one that needs somebody named beside it. The checks then read as two glass
 * groups — the person's own, and the ones a Portfolio needs — each row carrying its
 * state in colour and the single way on.
 */
export default function VerificationScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const { state, activeContext } = useAuth();
  const me = state.status === "signed_in" ? state.me : null;
  const [payload, setPayload] = useState<TrustPayload | null>(null);
  const [settlement, setSettlement] = useState<SettlementOverview | null | undefined>();
  const [error, setError] = useState("");
  const [settlementError, setSettlementError] = useState("");

  const load = useCallback(async () => {
    try {
      setPayload(await apiFetch<TrustPayload>("/trust/verifications/"));
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load verification.");
    }

    // The Portfolio's settlement account belongs to whoever operates the
    // Portfolio — an invited administrator included. Gating it on their own
    // provider journey hid it from exactly the people it is a task for.
    if (!me?.capabilities.provider.workspace_access && !me?.capabilities.provider.exists) {
      setSettlement(null);
      return;
    }
    try {
      const organizations = await listOrganizations();
      const contextualId = activeContext?.startsWith("organization:")
        ? activeContext.slice("organization:".length)
        : "";
      const organization =
        organizations.find((row) => row.id === contextualId) ?? organizations[0] ?? null;
      if (!organization) {
        setSettlement({ organization: null, mayManage: false, destination: null });
        setSettlementError("");
        return;
      }
      const mayManage = ["owner", "admin"].includes(organization.current_user_role);
      const destination = mayManage ? await getPayoutDestination(organization.id) : null;
      setSettlement({ organization, mayManage, destination });
      setSettlementError("");
    } catch (cause) {
      setSettlementError(
        cause instanceof ApiFailure
          ? cause.error.message
          : "Could not load the settlement-account check.",
      );
    }
  }, [activeContext, me]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const kinds = RELEVANT_KINDS[me?.primary_role as keyof typeof RELEVANT_KINDS]
    ?? RELEVANT_KINDS.tenant;

  const yours: Check[] = payload ? kinds.map((kind) => {
    const entry = payload.summary[kind] ?? emptyTrustEntry;
    const open = kind === "identity" && entry.state !== "verified";
    return {
      key: kind,
      icon: KIND_ICON[kind] ?? "shield-checkmark-outline",
      title: KIND_LABEL[kind] ?? kind,
      detail: personalCheckDetail(kind, entry),
      state: entry.state,
      actionLabel: open ? "Continue" : undefined,
      onPress: open ? () => router.push("/(app)/identity-verification" as never) : undefined,
    };
  }) : [];

  const business: Check[] = [];
  if (payload && me?.capabilities.provider.exists) {
    business.push({
      key: "provider",
      icon: "shield-checkmark-outline",
      title: "Provider verification",
      detail: "Your approval to operate property services on Rooomly.",
      state: providerTrustState(me.capabilities.provider.verification_status),
      statusLabel: providerStatusLabel(me.capabilities.provider.verification_status),
      actionLabel: "View",
      onPress: () => router.push("/(app)/provider" as never),
    });
  }
  if (payload && (me?.capabilities.provider.workspace_access || me?.capabilities.provider.exists)) {
    business.push(settlementCheck(settlement, settlementError, (organizationId) => router.push({
      pathname: "/(app)/payout-account",
      params: { organizationId },
    })));
  }

  const all = [...yours, ...business];
  const done = all.filter((check) => check.state === "verified").length;
  const waiting = all.find((check) => check.onPress && check.state !== "verified")
    ?? all.find((check) => check.state !== "verified");

  return (
    <IndexGround>
      <ScrollView contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom, gap: density.sectionGap + space[2] }}>
        {error ? <Notice tone="error" title={error} /> : null}
        {!payload && !error ? <ChecksSkeleton /> : null}

        {payload ? (
          <>
            <View style={styles.hero}>
              <Progress done={done} total={all.length} />
              <View style={styles.heroText}>
                <Type variant="title2" style={styles.heroTitle}>
                  {done === all.length ? "Everything is verified" : `${all.length - done} ${all.length - done === 1 ? "check needs" : "checks need"} you`}
                </Type>
                <Type variant="caption" numberOfLines={3} style={styles.heroDetail}>
                  {done === all.length
                    ? "Nothing is waiting. We will tell you if a check ever expires."
                    : waiting
                      ? `${waiting.title} · ${waiting.statusLabel ?? stateLabel(waiting.state)}`
                      : "Rooomly confirms each of these once."}
                </Type>
              </View>
            </View>

            <CheckGroup title="Your checks" checks={yours} />
            {business.length ? <CheckGroup title="Your Portfolio" checks={business} /> : null}
          </>
        ) : null}
      </ScrollView>
    </IndexGround>
  );
}

/** How far the checks have got, as one ring: the arc is what is confirmed. */
function Progress({ done, total }: { done: number; total: number }) {
  const size = 84;
  const stroke = 8;
  const radiusOf = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radiusOf;
  const share = total ? done / total : 0;
  return (
    <View accessible accessibilityLabel={`${done} of ${total} checks verified`} style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radiusOf} stroke={alpha(DEEP, 0.1)} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radiusOf}
          stroke={share === 1 ? KOLA : HARMATTAN}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * share} ${circumference}`}
          fill="none"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.ringCentre} pointerEvents="none">
        <Type variant="bodyStrong" style={styles.ringCount}>{done}/{total}</Type>
        <Type variant="label" style={styles.ringLabel}>DONE</Type>
      </View>
    </View>
  );
}

function CheckGroup({ title, checks }: { title: string; checks: Check[] }) {
  if (!checks.length) return null;
  return (
    <View style={styles.section}>
      <GroupLabel>{title}</GroupLabel>
      <Panel>
        {checks.map((check, index) => <CheckRow key={check.key} check={check} first={index === 0} />)}
      </Panel>
    </View>
  );
}

/**
 * One check: what it is and where it stands, said in words and in its colour, with
 * the single way on where the lifecycle offers one.
 */
function CheckRow({ check, first }: { check: Check; first: boolean }) {
  const tone = stateTone(check.state);
  const status = check.statusLabel ?? stateLabel(check.state);
  const body = (
    <>
      <View style={[rowStyles.well, styles.well, { backgroundColor: tone.wash }]}>
        <Ionicons name={check.state === "verified" ? "checkmark" : check.icon} size={17} color={tone.ink} />
      </View>
      <View style={rowStyles.rowBody}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{check.title}</Type>}
          end={<Type variant="caption" numberOfLines={1} style={[rowStyles.rowStatus, { color: tone.text }]}>{status}</Type>}
        />
        <Type variant="caption" numberOfLines={3} style={rowStyles.rowSub}>{check.detail}</Type>
        {check.actionLabel ? (
          <View style={styles.act}>
            <Type variant="captionStrong" style={styles.actText}>{check.actionLabel}</Type>
            <Ionicons name="arrow-forward" size={13} color={KOLA_DEEP} />
          </View>
        ) : null}
      </View>
    </>
  );

  if (!check.onPress) return <View style={[rowStyles.row, first ? null : styles.ruled]}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${check.title}, ${status}, ${check.actionLabel ?? "View"}`}
      onPress={check.onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, first ? null : styles.ruled, pressed && !isAndroid ? { backgroundColor: PRESSED } : null]}
    >
      {body}
    </Pressable>
  );
}

/** Shaped like the ring and the first rows, so nothing jumps when they arrive. */
function ChecksSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading verification" style={styles.skeleton}>
      <View style={styles.hero}>
        <Bone width={84} height={84} round={42} />
        <View style={styles.heroText}>
          <Bone width="64%" height={20} />
          <Bone width="82%" />
        </View>
      </View>
      <Panel>
        {[0, 1].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={32} height={32} round={10} />
            <View style={styles.skeletonLines}>
              <Bone width="44%" height={14} />
              <Bone width="76%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

/**
 * The Portfolio's settlement account, read as a check.
 *
 * Every state it can be in says what it is waiting on: no Portfolio, somebody
 * else's to manage, nothing added, an account waiting to be chosen, or verified.
 */
function settlementCheck(
  settlement: SettlementOverview | null | undefined,
  error: string,
  onSetup: (organizationId: string) => void,
): Check {
  const base = { key: "settlement", icon: "card-outline" as IconName, title: "Bank or Mobile Money" };
  if (error) return { ...base, state: "unverified", statusLabel: "Unavailable", detail: error };
  if (settlement === undefined) {
    return { ...base, state: "pending", statusLabel: "Loading", detail: "Checking your active Portfolio." };
  }
  if (!settlement?.organization) {
    return { ...base, state: "unverified", statusLabel: "Portfolio needed", detail: "Create a Portfolio before adding a receiving account." };
  }
  if (!settlement.mayManage) {
    return { ...base, state: "unverified", statusLabel: "Owner managed", detail: `${settlement.organization.name} · An owner or admin manages receiving details.` };
  }

  const profile = settlement.destination?.active_profile ?? settlement.destination?.profile;
  const savedProfiles = settlement.destination?.profiles ?? [];
  const verified = profile?.status === "verified";
  return {
    ...base,
    state: verified ? "verified" : profile ? "pending" : "unverified",
    statusLabel: verified ? "Verified" : profile ? profile.status_display : savedProfiles.length ? "Selection needed" : "Not set up",
    detail: profile
      ? `${settlement.organization.name} · ${profile.institution} · ${profile.masked_account}`
      : savedProfiles.length
        ? `${settlement.organization.name} · Choose which verified account should receive new rent payments.`
        : `${settlement.organization.name} · Add where Paystack should send rent.`,
    actionLabel: profile || savedProfiles.length ? "Manage" : "Set up",
    onPress: () => onSetup(settlement.organization!.id),
  };
}

const emptyTrustEntry: TrustEntry = {
  state: "unverified",
  decided_at: null,
  expires_at: null,
  method: "",
};

function personalCheckDetail(kind: string, entry: TrustEntry): string {
  if (entry.state === "verified") {
    return entry.decided_at ? `Confirmed ${formatDate(entry.decided_at)}.` : "Confirmed on your account.";
  }
  if (entry.state === "pending") return "With the verification team. We will notify you when it changes.";
  if (entry.state === "expired") return "This check needs to be completed again.";
  if (kind === "phone") return "Confirm your phone number during sign in.";
  if (kind === "identity") return "Use a government-issued identity document.";
  return "Complete this through provider verification when it is required.";
}

function providerTrustState(status: string | null): TrustState {
  if (status === "approved") return "verified";
  if (status === "pending") return "pending";
  if (status === "expired") return "expired";
  return "unverified";
}

function providerStatusLabel(status: string | null): string {
  return {
    approved: "Approved",
    pending: "In review",
    needs_more_info: "Action needed",
    rejected: "Not approved",
    revoked: "Revoked",
    expired: "Out of date",
    not_started: "Not started",
  }[status ?? "not_started"] ?? "Not started";
}

function stateLabel(state: TrustState): string {
  return { verified: "Verified", pending: "In progress", unverified: "Not checked", expired: "Out of date" }[state];
}

/** Confirmed in kola, under way in harmattan, out of date in laterite, untouched quiet. */
function stateTone(state: TrustState) {
  return {
    verified: { text: KOLA, ink: KOLA_DEEP, wash: theme.color.kola["50"] },
    pending: { text: HARMATTAN, ink: HARMATTAN, wash: theme.color.harmattan["100"] },
    unverified: { text: MUTED, ink: theme.color.ink["700"], wash: theme.color.field["100"] },
    expired: { text: LATERITE, ink: LATERITE, wash: theme.color.laterite["100"] },
  }[state];
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
  },
  heroText: {
    flex: 1,
    minWidth: 0,
    gap: space[1],
  },
  heroTitle: {
    fontSize: 19,
    lineHeight: 25,
    letterSpacing: -0.2,
    color: INK,
  },
  heroDetail: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  ringCentre: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  ringCount: {
    fontSize: 18,
    lineHeight: 22,
    color: INK,
    fontVariant: ["tabular-nums"],
  },
  ringLabel: {
    color: MUTED,
    letterSpacing: 0.6,
  },
  section: {
    gap: space[2],
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  well: {
    marginTop: 2,
  },
  act: {
    alignSelf: "flex-start",
    minHeight: 28,
    marginTop: space[2],
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: theme.color.kola["50"],
  },
  actText: {
    fontSize: 13,
    lineHeight: 17,
    color: KOLA_DEEP,
  },
  skeleton: {
    gap: space[5],
  },
  skeletonRow: {
    flexDirection: "row",
    gap: space[3],
    padding: 14,
  },
  skeletonLines: {
    flex: 1,
    justifyContent: "center",
    gap: space[2],
  },
});
