import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Field, Notice, Type, space } from "@/components/ui";
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
} from "@/organizations";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

export default function PayoutAccountScreen() {
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

  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[5] }}>
    <View style={{ gap: space[1] }}><Type variant="label">PAYOUT DESTINATION</Type><Type variant="display2" accessibilityRole="header">Settlement account</Type><Type variant="body">Choose where Paystack sends rent after fees.</Type></View>
    {error ? <Notice tone="error" title={error} /> : null}
    {mayManage === false && organizationId ? <Notice tone="warning" title="Owner or admin access required" body="Only a Portfolio owner or admin can change where rent is settled." /> : null}
    {busy === "load" ? <Type variant="caption">Loading settlement details…</Type> : null}
    {state && mayManage ? <>
      <View style={{ gap: space[3] }}>
        <View style={{ gap: space[1] }}><Type variant="label">RECEIVING ACCOUNTS</Type><Type variant="title1" accessibilityRole="header">Where rent can arrive</Type></View>
        {state.profiles.map((profile) => <View key={profile.id} style={{ gap: space[3], paddingVertical: space[4], borderTopWidth: 1, borderColor: theme.color.field["200"] }}>
          <View style={{ gap: space[1] }}><View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[2] }}><Type variant="bodyStrong">{profile.account_name}</Type>{profile.is_active ? <Type variant="label" style={{ color: theme.color.kola["600"] }}>IN USE</Type> : null}</View><Type variant="body">{profile.institution} · {profile.masked_account}</Type><Type variant="caption">{profile.status_display}{profile.is_active ? " · Used for new rent payments" : ""}</Type></View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {profile.status === "unverified" ? <Button label="Check verification status" variant="secondary" busy={busy === `refresh:${profile.id}`} onPress={() => void checkVerification(profile.id)} /> : null}
            {profile.status === "verified" && !profile.is_active ? <Button label="Use this account" variant="secondary" busy={busy === `activate:${profile.id}`} onPress={() => void selectAccount(profile.id)} /> : null}
            {removeCandidate !== profile.id ? <Pressable accessibilityRole="button" onPress={() => setRemoveCandidate(profile.id)} {...pressableFeedback(theme.color.field["100"])} style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: space[2] }}><Type variant="caption">Remove</Type></Pressable> : null}
          </View>
          {removeCandidate === profile.id ? <View style={{ gap: space[2], paddingTop: space[2] }}><Type variant="bodyStrong">Remove from future use?</Type><Type variant="caption">Payments already in progress and historical records will keep this destination.</Type><View style={{ gap: space[2] }}><Button label="Yes, remove account" variant="destructive" busy={busy === `remove:${profile.id}`} onPress={() => void removeAccount(profile.id)} /><Button label="Keep account" variant="quiet" onPress={() => setRemoveCandidate("")} /></View></View> : null}
        </View>)}
        {!state.profiles.length ? <Type variant="body">Add a bank or Mobile Money account, then verify it with Paystack.</Type> : null}
        <Button label={showSetup ? "Close account setup" : "Add receiving account"} variant="secondary" onPress={() => setShowSetup((value) => !value)} />
      </View>
      {state.profiles.length > 0 && !state.active_profile ? <Notice tone="warning" title="Choose an account for new payments" body="Online rent payments remain unavailable until a verified account is selected." /> : null}
      {statusNote ? <Notice tone="info" title="Settlement account updated" body={statusNote} /> : null}
      {checking ? <Notice tone="info" title="Checking with Paystack" body="The first request may have completed. Rooomly is finding that exact setup before allowing another attempt." /> : <View style={{ gap: space[4], paddingTop: space[2] }}>
        {(showSetup || state.profiles.length === 0) ? <><View style={{ gap: space[1] }}><Type variant="label">ADD ACCOUNT</Type><Type variant="title1" accessibilityRole="header">Receiving details</Type></View>
        <View accessibilityRole="tablist" style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}>
          <MethodTab label="Bank account" selected={method === "bank"} onPress={() => changeMethod("bank")} />
          <MethodTab label="Mobile Money" selected={method === "mobile_money"} onPress={() => changeMethod("mobile_money")} />
        </View>
        {bankCode && !choosingInstitution ? <Pressable accessibilityRole="button" accessibilityLabel={`Change ${method === "bank" ? "bank" : "network"}, currently ${selectedInstitution?.name}`} onPress={() => setChoosingInstitution(true)} {...pressableFeedback(theme.color.field["100"])} style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: space[3], borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}><View style={{ flex: 1, gap: space[1] }}><Type variant="caption">{method === "bank" ? "Bank" : "Network"}</Type><Type variant="bodyStrong">{selectedInstitution?.name}</Type></View><Type variant="caption" style={{ color: theme.color.kola["600"] }}>Change</Type></Pressable> : <View style={{ gap: space[2] }}>
          <Field label={method === "bank" ? "Find your bank" : "Find your network"} value={institutionQuery} onChangeText={setInstitutionQuery} placeholder="Search" returnKeyType="search" />
          <View style={{ borderTopWidth: 1, borderTopColor: theme.color.field["200"] }}>{visibleInstitutions.map((institution) => <Pressable key={institution.code} accessibilityRole="radio" accessibilityState={{ checked: bankCode === institution.code }} onPress={() => { setBankCode(institution.code); setChoosingInstitution(false); setResolved(null); }} {...pressableFeedback(theme.color.field["100"])} style={{ minHeight: 52, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}><Type variant="bodyStrong">{institution.name}</Type></Pressable>)}</View>
          {!visibleInstitutions.length ? <Type variant="caption">No matching institution.</Type> : null}
        </View>}
        {bankCode ? <Field label={method === "bank" ? "Account number" : "Mobile Money number"} value={accountNumber} onChangeText={(value) => { setAccountNumber(value.replace(/\s/g, "")); setResolved(null); }} keyboardType="number-pad" autoComplete="off" textContentType="none" hint="Used only to create the Paystack subaccount. Rooomly does not retain this number." /> : null}
        {method === "bank" && bankCode && !resolved ? <Button label="Confirm account" variant="secondary" busy={busy === "resolve"} disabled={!accountNumber.trim()} onPress={() => void confirmAccount()} /> : null}
        {resolved ? <View style={{ flexDirection: "row", gap: space[3], paddingVertical: space[4], borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.color.kola["300"] }}><Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>✓</Type><View style={{ flex: 1, gap: space[1] }}><Type variant="bodyStrong">{resolved.account_name}</Type><Type variant="caption">{selectedInstitution?.name} · {resolved.masked_account}</Type></View></View> : null}
        {(method === "mobile_money" && bankCode || resolved) ? <View style={{ gap: space[3] }}><Button label="Add receiving account" busy={busy === "save"} disabled={!accountNumber.trim()} onPress={() => void saveAccount()} /><Type variant="caption">Property owners bear Paystack’s transaction fee. Adding or switching an account does not redirect payments already in progress.</Type></View> : null}</> : null}
      </View>}
    </> : null}
  </ScrollView>;
}

function MethodTab({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} {...pressableFeedback(theme.color.field["100"])} style={{ flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center", borderBottomWidth: 2, borderBottomColor: selected ? theme.color.kola["600"] : "transparent" }}><Type variant="bodyStrong" style={{ color: selected ? theme.color.kola["600"] : theme.color.ink["500"] }}>{label}</Type></Pressable>;
}
