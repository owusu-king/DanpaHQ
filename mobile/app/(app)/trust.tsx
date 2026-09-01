import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth, type TrustEntry, type TrustState } from "@/auth";
import { Notice, Type, space } from "@/components/ui";
import {
  getPayoutDestination,
  listOrganizations,
  type Organization,
  type PayoutDestinationState,
} from "@/organizations";
import { pressableFeedback } from "@/platform";
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

/** A status overview; the work itself continues on focused, resumable screens. */
export default function VerificationScreen() {
  const router = useRouter();
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

    if (!me?.capabilities.provider.exists) {
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

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[6] }}>
      <View style={{ gap: space[2] }}>
        <Type variant="label">TRUST &amp; IDENTITY</Type>
        <Type variant="display2" accessibilityRole="header">Verification</Type>
        <Type variant="body" style={{ color: theme.color.ink["500"] }}>
          See what Rooomly has confirmed and continue only the checks that need you.
        </Type>
      </View>

      {error ? <Notice tone="error" title={error} /> : null}
      {!payload && !error ? (
        <View style={{ paddingVertical: space[10], alignItems: "center" }}>
          <ActivityIndicator color={theme.color.kola["600"]} />
        </View>
      ) : null}

      {payload ? (
        <View style={{ borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}>
          {kinds.map((kind) => {
            const entry = payload.summary[kind] ?? emptyTrustEntry;
            const detail = personalCheckDetail(kind, entry);
            return (
              <VerificationRow
                key={kind}
                icon={kind === "phone" ? "phone-portrait-outline" : kind === "identity" ? "person-outline" : "briefcase-outline"}
                title={KIND_LABEL[kind] ?? kind}
                state={entry.state}
                detail={detail}
                actionLabel={kind === "identity" && entry.state !== "verified" ? "Continue" : undefined}
                onPress={kind === "identity" && entry.state !== "verified"
                  ? () => router.push("/(app)/identity-verification" as never)
                  : undefined}
              />
            );
          })}

          {me?.capabilities.provider.exists ? (
            <VerificationRow
              icon="shield-checkmark-outline"
              title="Provider verification"
              state={providerTrustState(me.capabilities.provider.verification_status)}
              statusLabel={providerStatusLabel(me.capabilities.provider.verification_status)}
              detail="Your approval to operate property services on Rooomly."
              actionLabel="View"
              onPress={() => router.push("/(app)/provider" as never)}
            />
          ) : null}

          {me?.capabilities.provider.exists ? (
            <SettlementRow
              settlement={settlement}
              error={settlementError}
              onSetup={(organizationId) => router.push({
                pathname: "/(app)/payout-account",
                params: { organizationId },
              })}
            />
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function SettlementRow({
  settlement,
  error,
  onSetup,
}: {
  settlement: SettlementOverview | null | undefined;
  error: string;
  onSetup: (organizationId: string) => void;
}) {
  if (error) {
    return <VerificationRow icon="card-outline" title="Bank or Mobile Money" state="unverified" statusLabel="Unavailable" detail={error} />;
  }
  if (settlement === undefined) {
    return <VerificationRow icon="card-outline" title="Bank or Mobile Money" state="pending" statusLabel="Loading" detail="Checking your active Portfolio." />;
  }
  if (!settlement?.organization) {
    return <VerificationRow icon="card-outline" title="Bank or Mobile Money" state="unverified" statusLabel="Portfolio needed" detail="Create a Portfolio before adding a receiving account." />;
  }
  if (!settlement.mayManage) {
    return <VerificationRow icon="card-outline" title="Bank or Mobile Money" state="unverified" statusLabel="Owner managed" detail={`${settlement.organization.name} · An owner or admin manages receiving details.`} />;
  }

  const profile = settlement.destination?.active_profile ?? settlement.destination?.profile;
  const savedProfiles = settlement.destination?.profiles ?? [];
  const verified = profile?.status === "verified";
  return (
    <VerificationRow
      icon="card-outline"
      title="Bank or Mobile Money"
      state={verified ? "verified" : profile ? "pending" : "unverified"}
      statusLabel={verified ? "Verified" : profile ? profile.status_display : savedProfiles.length ? "Selection needed" : "Not set up"}
      detail={profile
        ? `${settlement.organization.name} · ${profile.institution} · ${profile.masked_account}`
        : savedProfiles.length
          ? `${settlement.organization.name} · Choose which verified account should receive new rent payments.`
          : `${settlement.organization.name} · Add where Paystack should send rent.`}
      actionLabel={profile || savedProfiles.length ? "Manage" : "Set up"}
      onPress={() => onSetup(settlement.organization!.id)}
    />
  );
}

function VerificationRow({
  icon,
  title,
  state,
  detail,
  statusLabel,
  actionLabel,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  state: TrustState;
  detail: string;
  statusLabel?: string;
  actionLabel?: string;
  onPress?: () => void;
}) {
  const tone = stateTone(state);
  const content = (
    <>
      <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: tone.background }}>
        <Ionicons name={state === "verified" ? "checkmark" : icon} size={19} color={tone.foreground} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: space[1] }}>
        <Type variant="bodyStrong">{title}</Type>
        <Type variant="caption">{detail}</Type>
      </View>
      <View style={{ alignItems: "flex-end", gap: space[1] }}>
        <Type variant="caption" style={{ color: tone.foreground, fontWeight: "600" }}>
          {statusLabel ?? stateLabel(state)}
        </Type>
        {actionLabel ? <Type variant="caption" style={{ color: theme.color.kola["600"], fontWeight: "600" }}>{actionLabel} →</Type> : null}
      </View>
    </>
  );
  const style = {
    minHeight: 82,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: space[3],
    paddingVertical: space[4],
    borderTopWidth: 1,
    borderTopColor: theme.color.field["200"],
  };

  if (!onPress) return <View style={style}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${title}, ${statusLabel ?? stateLabel(state)}, ${actionLabel ?? "View"}`}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["100"])}
      style={({ pressed }) => [style, pressed ? { opacity: 0.82 } : null]}
    >
      {content}
    </Pressable>
  );
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

function stateTone(state: TrustState) {
  return {
    verified: { foreground: theme.color.kola["600"], background: theme.color.kola["50"] },
    pending: { foreground: theme.color.harmattan["600"], background: theme.color.harmattan["100"] },
    unverified: { foreground: theme.color.ink["500"], background: theme.color.field["100"] },
    expired: { foreground: theme.color.laterite["600"], background: theme.color.laterite["100"] },
  }[state];
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}
