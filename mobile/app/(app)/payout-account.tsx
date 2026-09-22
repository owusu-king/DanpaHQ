import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Panel, SmallAct } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  EDGE,
  Footnote,
  GroupLabel,
  HARMATTAN,
  INK,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  MUTED,
  PRESSED,
  QuietAction,
  RULE,
  RowLine,
  SearchField,
  rowStyles,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { Button, Field, Notice, Type, radius, space } from "@/components/ui";
import {
  activatePayoutDestination,
  getPayoutDestination,
  listOrganizations,
  listPayoutInstitutions,
  provisionPayoutDestination,
  refreshPayoutVerification,
  removePayoutDestination,
  resolvePayoutAccount,
  type PayoutDestinationState,
  type PayoutInstitution,
  type PayoutMethod,
  type PayoutProfile,
} from "@/organizations";
import { isAndroid, pressableFeedback, useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * Where Paystack sends rent after fees.
 *
 * Refined on review (2026-09-15): the account in use leads as a card, because that
 * is the one fact this page exists to state. Every account the Portfolio has saved
 * follows as one glass list, each row carrying its verification and the one act it
 * offers; adding another is a panel opened on request rather than a form sitting
 * under the record. Nothing about provisioning, verification or removal changed.
 */
export default function PayoutAccountScreen() {
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const params = useLocalSearchParams<{ organizationId?: string }>();
  const [organizationId, setOrganizationId] = useState(params.organizationId ?? "");
  const [mayManage, setMayManage] = useState<boolean | null>(null);
  const [state, setState] = useState<PayoutDestinationState | null>(null);
  const [method, setMethod] = useState<PayoutMethod>("bank");
  const [institutions, setInstitutions] = useState<PayoutInstitution[]>([]);
  const [bankCode, setBankCode] = useState("");
  const [institutionQuery, setInstitutionQuery] = useState("");
  const [choosingInstitution, setChoosingInstitution] = useState(true);
  const [accountNumber, setAccountNumber] = useState("");
  const [resolved, setResolved] = useState<{ account_name: string; masked_account: string } | null>(null);
  const [busy, setBusy] = useState("load");
  const [showSetup, setShowSetup] = useState(false);
  const [removeCandidate, setRemoveCandidate] = useState("");
  const [error, setError] = useState("");
  const [statusNote, setStatusNote] = useState("");

  const load = useCallback(async () => {
    setBusy("load");
    try {
      const organizations = await listOrganizations();
      const requested = params.organizationId ?? organizationId;
      const organization = organizations.find((row) => row.id === requested) ?? organizations[0];
      if (!organization) {
        setOrganizationId(""); setMayManage(false); setState(null); setError("Create a Portfolio before setting up a settlement account.");
        return;
      }
      const allowed = organization.current_user_role === "owner" || organization.current_user_role === "admin";
      setOrganizationId(organization.id); setMayManage(allowed);
      if (!allowed) {
        setState(null); setError("");
        return;
      }
      const destination = await getPayoutDestination(organization.id);
      setState(destination);
      try {
        setInstitutions(await listPayoutInstitutions(organization.id, method));
        setError("");
      } catch (cause) {
        // An institution-directory outage must not hide an already configured
        // destination. Keep the financial record visible and disable setup.
        setInstitutions([]);
        setError(cause instanceof ApiFailure ? cause.error.message : "Could not load payout institutions.");
      }
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load the settlement account.");
    } finally { setBusy(""); }
  }, [method, organizationId, params.organizationId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const selectedInstitution = institutions.find((row) => row.code === bankCode);
  const visibleInstitutions = useMemo(() => {
    const needle = institutionQuery.trim().toLocaleLowerCase("en-GH");
    return institutions.filter((row) => !needle || row.name.toLocaleLowerCase("en-GH").includes(needle)).slice(0, 30);
  }, [institutionQuery, institutions]);
  const checking = state?.provisioning?.checking === true;
  const active = state?.active_profile ?? null;

  function changeMethod(next: PayoutMethod) {
    setMethod(next); setBankCode(""); setInstitutionQuery(""); setChoosingInstitution(true);
    setAccountNumber(""); setResolved(null); setError("");
  }

  async function confirmAccount() {
    if (!organizationId || !bankCode || !accountNumber.trim()) return;
    setBusy("resolve"); setError("");
    try {
      setResolved(await resolvePayoutAccount(organizationId, { method, bank_code: bankCode, account_number: accountNumber.trim() }));
    } catch (cause) {
      setResolved(null);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not confirm that account.");
    } finally { setBusy(""); }
  }

  async function saveAccount() {
    if (!organizationId || !bankCode || !accountNumber.trim()) return;
    setBusy("save"); setError("");
    try {
      setState(await provisionPayoutDestination(organizationId, { method, bank_code: bankCode, account_number: accountNumber.trim() }));
      setStatusNote("Account added. Verify it before selecting it for new payments.");
      setAccountNumber(""); setResolved(null); setShowSetup(false);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not save that settlement account.");
    } finally { setBusy(""); }
  }

  async function checkVerification(profileId: string) {
    if (!organizationId) return;
    setBusy(`refresh:${profileId}`); setError(""); setStatusNote("");
    try {
      const next = await refreshPayoutVerification(organizationId, profileId);
      setState(next);
      if (next.profiles.find((row) => row.id === profileId)?.status !== "verified") {
        setStatusNote("Paystack still reports this settlement account as not verified. Confirm it under Subaccounts in the same Paystack mode, then check again.");
      }
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not check verification with Paystack.");
    } finally { setBusy(""); }
  }

  async function selectAccount(profileId: string) {
    if (!organizationId) return;
    setBusy(`activate:${profileId}`); setError(""); setStatusNote("");
    try {
      setState(await activatePayoutDestination(organizationId, profileId));
      setStatusNote("New rent payments will use this account. Payments already in progress are unchanged.");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not select that settlement account.");
    } finally { setBusy(""); }
  }

  async function removeAccount(profileId: string) {
    if (!organizationId) return;
    setBusy(`remove:${profileId}`); setError(""); setStatusNote("");
    try {
      setState(await removePayoutDestination(organizationId, profileId));
      setRemoveCandidate("");
      setStatusNote("Account removed from future use. Existing payment and settlement records remain unchanged.");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not remove that settlement account.");
    } finally { setBusy(""); }
  }

  return (
    <IndexGround>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom, gap: density.sectionGap + space[2] }}
      >
        {error ? <Notice tone="error" title={error} /> : null}
        {mayManage === false && organizationId ? <Notice tone="warning" title="Owner or admin access required" body="Only a Portfolio owner or admin can change where rent is settled." /> : null}
        {busy === "load" ? <SettlementSkeleton /> : null}

        {state && mayManage ? (
          <>
            <InUse profile={active} saved={state.profiles.length} />
            <Footnote>Paystack sends rent to this account after its fee. Payments already in progress are never redirected.</Footnote>

            {state.profiles.length > 0 && !state.active_profile ? (
              <Notice tone="warning" title="Choose an account for new payments" body="Online rent payments remain unavailable until a verified account is selected." />
            ) : null}
            {statusNote ? <Notice tone="info" title="Settlement account updated" body={statusNote} /> : null}

            <View style={styles.section}>
              <GroupLabel count={state.profiles.length || undefined}>Receiving accounts</GroupLabel>
              <Panel>
                {state.profiles.map((profile, index) => (
                  <View key={profile.id}>
                    <AccountRow
                      profile={profile}
                      first={index === 0}
                      busy={busy}
                      onCheck={() => void checkVerification(profile.id)}
                      onUse={() => void selectAccount(profile.id)}
                      onRemove={() => setRemoveCandidate(profile.id)}
                      removing={removeCandidate === profile.id}
                    />
                    {removeCandidate === profile.id ? (
                      <View style={styles.confirm}>
                        <Type variant="bodyStrong" style={styles.confirmTitle}>Remove from future use?</Type>
                        <Type variant="caption" style={rowStyles.rowSub}>
                          Payments already in progress and historical records will keep this destination.
                        </Type>
                        <View style={styles.confirmActions}>
                          <Button label="Yes, remove account" variant="destructive" busy={busy === `remove:${profile.id}`} onPress={() => void removeAccount(profile.id)} />
                          <Button label="Keep account" variant="quiet" onPress={() => setRemoveCandidate("")} />
                        </View>
                      </View>
                    ) : null}
                  </View>
                ))}
                {!state.profiles.length ? (
                  <View style={styles.none}>
                    <Type variant="caption" style={rowStyles.rowSub}>
                      Add a bank or Mobile Money account, then verify it with Paystack.
                    </Type>
                  </View>
                ) : null}
              </Panel>
              {!showSetup && state.profiles.length ? (
                <View style={styles.addRow}>
                  <QuietAction icon="add-circle-outline" label="Add receiving account" onPress={() => setShowSetup(true)} />
                </View>
              ) : null}
            </View>

            {checking ? (
              <Notice tone="info" title="Checking with Paystack" body="The first request may have completed. Rooomly is finding that exact setup before allowing another attempt." />
            ) : showSetup || state.profiles.length === 0 ? (
              <View style={styles.section}>
                <GroupLabel>Add an account</GroupLabel>
                <Panel style={styles.setup}>
                  <View accessibilityRole="radiogroup" accessibilityLabel="How rent arrives" style={styles.methods}>
                    <MethodChoice label="Bank account" icon="business-outline" selected={method === "bank"} onPress={() => changeMethod("bank")} />
                    <MethodChoice label="Mobile Money" icon="phone-portrait-outline" selected={method === "mobile_money"} onPress={() => changeMethod("mobile_money")} />
                  </View>

                  {bankCode && !choosingInstitution ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Change ${method === "bank" ? "bank" : "network"}, currently ${selectedInstitution?.name}`}
                      onPress={() => setChoosingInstitution(true)}
                      {...pressableFeedback(PRESSED)}
                      style={({ pressed }) => [styles.chosen, pressed && !isAndroid ? { opacity: 0.85 } : null]}
                    >
                      <View style={[rowStyles.well, styles.chosenWell]}>
                        <Ionicons name={method === "bank" ? "business-outline" : "phone-portrait-outline"} size={16} color={KOLA} />
                      </View>
                      <View style={rowStyles.rowBody}>
                        <Type variant="caption" style={rowStyles.rowSub}>{method === "bank" ? "Bank" : "Network"}</Type>
                        <Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{selectedInstitution?.name}</Type>
                      </View>
                      <Type variant="captionStrong" style={styles.change}>Change</Type>
                    </Pressable>
                  ) : (
                    <View style={styles.chooser}>
                      <SearchField
                        label={method === "bank" ? "Find your bank" : "Find your network"}
                        placeholder="Search"
                        value={institutionQuery}
                        onChangeText={setInstitutionQuery}
                      />
                      <View style={styles.institutions}>
                        {visibleInstitutions.map((institution, index) => (
                          <Pressable
                            key={institution.code}
                            accessibilityRole="radio"
                            aria-checked={bankCode === institution.code}
                            accessibilityLabel={institution.name}
                            onPress={() => { setBankCode(institution.code); setChoosingInstitution(false); setResolved(null); }}
                            {...pressableFeedback(PRESSED)}
                            style={({ pressed }) => [styles.institution, index ? styles.ruled : null, pressed && !isAndroid ? { backgroundColor: PRESSED } : null]}
                          >
                            <Type variant="body" numberOfLines={1} style={styles.institutionName}>{institution.name}</Type>
                            {bankCode === institution.code ? <Ionicons name="checkmark" size={17} color={KOLA} /> : null}
                          </Pressable>
                        ))}
                        {!visibleInstitutions.length ? (
                          <View style={styles.institution}>
                            <Type variant="caption" style={rowStyles.rowSub}>No matching institution.</Type>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  )}

                  {bankCode ? (
                    <Field
                      label={method === "bank" ? "Account number" : "Mobile Money number"}
                      value={accountNumber}
                      onChangeText={(value) => { setAccountNumber(value.replace(/\s/g, "")); setResolved(null); }}
                      keyboardType="number-pad"
                      autoComplete="off"
                      textContentType="none"
                      hint="Used only to create the Paystack subaccount. Rooomly does not retain this number."
                    />
                  ) : null}

                  {method === "bank" && bankCode && !resolved ? (
                    <Button label="Confirm account" variant="secondary" busy={busy === "resolve"} disabled={!accountNumber.trim()} onPress={() => void confirmAccount()} />
                  ) : null}

                  {resolved ? (
                    <View style={styles.resolved}>
                      <View style={[rowStyles.well, styles.resolvedWell]}>
                        <Ionicons name="checkmark" size={16} color={KOLA} />
                      </View>
                      <View style={rowStyles.rowBody}>
                        <Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{resolved.account_name}</Type>
                        <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{selectedInstitution?.name} · {resolved.masked_account}</Type>
                      </View>
                    </View>
                  ) : null}

                  {(method === "mobile_money" && bankCode) || resolved ? (
                    <View style={styles.save}>
                      <Button label="Add receiving account" busy={busy === "save"} disabled={!accountNumber.trim()} onPress={() => void saveAccount()} />
                      <Type variant="caption" style={rowStyles.rowSub}>
                        Property owners bear Paystack’s transaction fee. Adding or switching an account does not
                        redirect payments already in progress.
                      </Type>
                    </View>
                  ) : null}

                  {state.profiles.length ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Close account setup"
                      onPress={() => setShowSetup(false)}
                      hitSlop={space[1]}
                      style={({ pressed }) => [styles.close, pressed && !isAndroid ? { opacity: 0.8 } : null]}
                    >
                      <Type variant="captionStrong" style={styles.closeText}>Close account setup</Type>
                    </Pressable>
                  ) : null}
                </Panel>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </IndexGround>
  );
}

/** The account rent arrives in, said once and first — or what is missing before one can. */
function InUse({ profile, saved }: { profile: PayoutProfile | null; saved: number }) {
  if (!profile) {
    return (
      <View style={[styles.hero, styles.heroQuiet]}>
        <View style={[styles.heroWell, { backgroundColor: theme.color.field["100"] }]}>
          <Ionicons name="card-outline" size={20} color={MUTED} />
        </View>
        <View style={styles.heroText}>
          <Type variant="bodyStrong" style={styles.heroTitle}>
            {saved ? "No account chosen yet" : "No receiving account yet"}
          </Type>
          <Type variant="caption" style={styles.heroBody}>
            {saved
              ? "Choose a verified account below and new rent payments will use it."
              : "Add a bank or Mobile Money account, then verify it with Paystack."}
          </Type>
        </View>
      </View>
    );
  }
  return (
    <View accessible accessibilityLabel={`In use: ${profile.account_name}, ${profile.institution}, ${profile.masked_account}, ${profile.status_display}`} style={styles.hero}>
      <View style={styles.heroHead}>
        <View style={[styles.heroWell, { backgroundColor: theme.color.kola["50"] }]}>
          <Ionicons name={profile.method === "bank" ? "business-outline" : "phone-portrait-outline"} size={20} color={KOLA} />
        </View>
        <Type variant="label" style={styles.inUse}>IN USE</Type>
      </View>
      <Type variant="amountLg" numberOfLines={1} style={styles.heroAccount}>{profile.masked_account}</Type>
      <Type variant="bodyStrong" numberOfLines={1} style={styles.heroName}>{profile.account_name}</Type>
      <Type variant="caption" numberOfLines={2} style={styles.heroBody}>{profile.institution} · {profile.status_display}</Type>
    </View>
  );
}

/**
 * One saved account: what it is and where its verification stands, with the acts
 * that state allows — check it, use it, or take it out of future use.
 */
function AccountRow({
  profile,
  first,
  busy,
  removing,
  onCheck,
  onUse,
  onRemove,
}: {
  profile: PayoutProfile;
  first: boolean;
  busy: string;
  removing: boolean;
  onCheck: () => void;
  onUse: () => void;
  onRemove: () => void;
}) {
  const tone = profile.status === "verified" ? KOLA : profile.status === "unverified" ? HARMATTAN : LATERITE;
  return (
    <View style={[rowStyles.row, first ? null : styles.ruled]}>
      <View style={[rowStyles.well, { backgroundColor: alpha(tone, 0.12) }]}>
        <Ionicons name={profile.method === "bank" ? "business-outline" : "phone-portrait-outline"} size={16} color={tone} />
      </View>
      <View style={rowStyles.rowBody}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{profile.account_name}</Type>}
          end={<Type variant="caption" numberOfLines={1} style={[rowStyles.rowStatus, { color: tone }]}>{profile.status_display}</Type>}
        />
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowSub}>
          {profile.institution} · {profile.masked_account}{profile.is_active ? " · Used for new rent payments" : ""}
        </Type>
        <View style={styles.acts}>
          {profile.status === "unverified" ? (
            <SmallAct label="Check verification status" icon="refresh-outline" busy={busy === `refresh:${profile.id}`} busyLabel="Checking…" onPress={onCheck} />
          ) : null}
          {profile.status === "verified" && !profile.is_active ? (
            <SmallAct label="Use this account" icon="checkmark-circle-outline" busy={busy === `activate:${profile.id}`} busyLabel="Selecting…" onPress={onUse} />
          ) : null}
          {!removing ? <SmallAct label="Remove" icon="close-circle-outline" onPress={onRemove} /> : null}
        </View>
      </View>
    </View>
  );
}

function MethodChoice({ label, icon, selected, onPress }: { label: string; icon: IconName; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityLabel={label}
      onPress={onPress}
      {...pressableFeedback(theme.color.kola["50"])}
      style={({ pressed }) => [styles.method, selected ? styles.methodChosen : null, pressed && !isAndroid ? { opacity: 0.85 } : null]}
    >
      <Ionicons name={icon} size={16} color={selected ? KOLA : MUTED} />
      <Type variant="captionStrong" numberOfLines={1} style={[styles.methodText, selected ? { color: KOLA_DEEP } : null]}>{label}</Type>
    </Pressable>
  );
}

/** Shaped like the card and the first rows, so nothing jumps when they arrive. */
function SettlementSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading settlement details" style={styles.skeleton}>
      <View style={[styles.hero, styles.heroQuiet]}>
        <Bone width={40} height={40} round={14} />
        <Bone width="58%" height={26} />
        <Bone width="44%" />
      </View>
      <Panel>
        {[0, 1].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={32} height={32} round={10} />
            <View style={rowStyles.rowBody}>
              <Bone width="52%" height={14} />
              <Bone width="74%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: space[2],
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  hero: {
    gap: space[1],
    padding: space[4],
    borderRadius: 16,
    borderWidth: 1,
    borderColor: alpha(KOLA, 0.24),
    backgroundColor: theme.color.kola["50"],
  },
  heroQuiet: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    borderColor: EDGE,
    backgroundColor: theme.color.field["0"],
  },
  heroHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    marginBottom: space[1],
  },
  heroWell: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  heroText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  inUse: {
    color: KOLA_DEEP,
    letterSpacing: 0.6,
  },
  heroAccount: {
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
    color: INK,
    fontVariant: ["tabular-nums"],
  },
  heroName: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  heroTitle: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  heroBody: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  acts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    marginTop: space[2],
  },
  none: {
    paddingVertical: space[4],
    paddingHorizontal: 14,
  },
  addRow: {
    paddingHorizontal: space[1],
  },
  confirm: {
    gap: space[2],
    paddingVertical: space[4],
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
    backgroundColor: alpha(LATERITE, 0.05),
  },
  confirmTitle: {
    fontSize: 14.5,
    lineHeight: 20,
    color: INK,
  },
  confirmActions: {
    gap: space[2],
    marginTop: space[1],
  },
  setup: {
    gap: space[4],
    padding: space[4],
  },
  methods: {
    flexDirection: "row",
    gap: space[2],
  },
  method: {
    flex: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: theme.color.field["0"],
  },
  methodChosen: {
    borderColor: alpha(KOLA, 0.4),
    backgroundColor: theme.color.kola["50"],
  },
  methodText: {
    fontSize: 13.5,
    lineHeight: 18,
    color: MUTED,
  },
  chooser: {
    gap: space[2],
  },
  institutions: {
    overflow: "hidden",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.color.field["200"],
    backgroundColor: theme.color.field["50"],
  },
  institution: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[4],
  },
  institutionName: {
    flex: 1,
    minWidth: 0,
    color: INK,
  },
  chosen: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[3],
    borderRadius: 14,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: theme.color.field["0"],
  },
  chosenWell: {
    backgroundColor: theme.color.kola["50"],
  },
  change: {
    fontSize: 13,
    lineHeight: 17,
    color: KOLA_DEEP,
  },
  resolved: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[3],
    borderRadius: 14,
    borderWidth: 1,
    borderColor: alpha(KOLA, 0.3),
    backgroundColor: theme.color.kola["50"],
  },
  resolvedWell: {
    backgroundColor: theme.color.field["0"],
  },
  save: {
    gap: space[2],
  },
  close: {
    minHeight: 40,
    alignSelf: "center",
    justifyContent: "center",
    paddingHorizontal: space[3],
  },
  closeText: {
    fontSize: 13,
    lineHeight: 18,
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
});
