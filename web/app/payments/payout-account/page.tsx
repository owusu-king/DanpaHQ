"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Empty, LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { Select } from "@/components/Select";
import { ApiFailure } from "@/lib/api";
import {
  activatePayoutDestination,
  getPayoutDestination,
  listOrganizations,
  listPayoutInstitutions,
  provisionPayoutDestination,
  refreshPayoutVerification,
  removePayoutDestination,
  resolvePayoutAccount,
  type Organization,
  type PayoutDestinationState,
  type PayoutInstitution,
  type PayoutMethod,
} from "@/lib/console";
import { useSession } from "@/lib/session";

export default function PayoutAccountPage() {
  return <Suspense fallback={<LoadingRows rows={4} />}><PayoutAccountContent /></Suspense>;
}

function PayoutAccountContent() {
  const search = useSearchParams();
  const { activeContext } = useSession();
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [state, setState] = useState<PayoutDestinationState | null>(null);
  const [method, setMethod] = useState<PayoutMethod>("bank");
  const [institutions, setInstitutions] = useState<PayoutInstitution[]>([]);
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [resolved, setResolved] = useState<{ account_name: string; masked_account: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [removeCandidate, setRemoveCandidate] = useState("");
  const [error, setError] = useState("");
  const [statusNote, setStatusNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    listOrganizations().then((rows) => {
      if (cancelled) return;
      const requested = search.get("organization") ?? "";
      const contextual = activeContext?.startsWith("organization:")
        ? activeContext.slice("organization:".length)
        : "";
      setOrganizations(rows);
      setOrganizationId(rows.find((row) => row.id === requested)?.id
        ?? rows.find((row) => row.id === contextual)?.id
        ?? rows[0]?.id
        ?? "");
    }).catch(() => { if (!cancelled) setError("Could not load your Portfolios."); });
    return () => { cancelled = true; };
  }, [activeContext, search]);

  const organization = organizations?.find((row) => row.id === organizationId);
  const mayManage = organization?.current_user_role === "owner" || organization?.current_user_role === "admin";

  const loadState = useCallback(async () => {
    if (!organizationId || !mayManage) { setState(null); return; }
    try {
      setState(await getPayoutDestination(organizationId));
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load the settlement account.");
    }
  }, [mayManage, organizationId]);

  useEffect(() => { setState(null); void loadState(); }, [loadState]);
  useEffect(() => {
    if (!organizationId || !mayManage) { setInstitutions([]); return; }
    let cancelled = false;
    setInstitutions([]); setBankCode(""); setResolved(null);
    listPayoutInstitutions(organizationId, method).then((rows) => {
      if (!cancelled) setInstitutions(rows);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof ApiFailure ? cause.error.message : "Could not load payout institutions.");
    });
    return () => { cancelled = true; };
  }, [mayManage, method, organizationId]);
  const checking = state?.provisioning?.checking === true;
  const institutionOptions = useMemo<readonly (readonly [string, string])[]>(
    () => [
      ["", method === "bank" ? "Choose a bank" : "Choose a mobile money network"] as const,
      ...institutions.map((row) => [row.code, row.name] as const),
    ],
    [institutions, method],
  );
  const selectedInstitution = institutions.find((row) => row.code === bankCode);

  async function confirmAccount() {
    if (!organizationId || !bankCode || !accountNumber.trim()) return;
    setBusy("resolve"); setError("");
    try {
      setResolved(await resolvePayoutAccount(organizationId, {
        method,
        bank_code: bankCode,
        account_number: accountNumber.trim(),
      }));
    } catch (cause) {
      setResolved(null);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not confirm that account.");
    } finally { setBusy(""); }
  }

  async function saveAccount() {
    if (!organizationId || !bankCode || !accountNumber.trim()) return;
    setBusy("save"); setError("");
    try {
      const next = await provisionPayoutDestination(organizationId, {
        method,
        bank_code: bankCode,
        account_number: accountNumber.trim(),
      });
      setState(next); setStatusNote("Account added. Verify it before selecting it for new payments."); setAccountNumber(""); setResolved(null); setShowSetup(false);
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

  return <div className="payout-account-page">
    <Link href="/payments?view=payouts" className="payout-back type-caption">← Back to payouts</Link>
    <PageHeader title="Settlement account" description="Choose where Paystack sends rent after fees." />
    {error ? <Notice tone="error" title={error} /> : null}
    {organizations === null ? <LoadingRows rows={3} /> : null}
    {organizations?.length === 0 ? <Empty title="Create a Portfolio first" body="A settlement account belongs to a Portfolio, not an individual team member." /> : null}
    {organizations && organizations.length > 1 ? <Select label="Portfolio" value={organizationId} onChange={setOrganizationId} options={organizations.map((row) => [row.id, row.name] as const)} /> : null}
    {organization && !mayManage ? <Notice tone="warning" title="Owner or admin access required" body="Only a Portfolio owner or admin can change where rent is settled." /> : null}
    {organizationId && mayManage && state === null && !error ? <LoadingRows rows={3} /> : null}

    {state && mayManage ? <>
      <section className="payout-accounts" aria-labelledby="saved-payout-title">
        <div className="payout-accounts-heading"><div><p className="type-label">RECEIVING ACCOUNTS</p><h2 id="saved-payout-title" className="type-title-1">Where rent can arrive</h2></div><Button variant="secondary" onClick={() => setShowSetup((value) => !value)}>{showSetup ? "Close" : "Add account"}</Button></div>
        {state.profiles.length ? <div className="payout-account-list">{state.profiles.map((profile) => <article className="payout-account-row" key={profile.id}>
          <div className="payout-account-copy"><div className="payout-account-name"><strong>{profile.account_name}</strong>{profile.is_active ? <span>In use</span> : null}</div><p>{profile.institution} · {profile.masked_account}</p><small>{profile.status_display}{profile.is_active ? " · Used for new rent payments" : ""}</small></div>
          <div className="payout-account-actions">
            {profile.status === "unverified" ? <Button variant="secondary" busy={busy === `refresh:${profile.id}`} onClick={() => void checkVerification(profile.id)}>Check verification status</Button> : null}
            {profile.status === "verified" && !profile.is_active ? <Button variant="secondary" busy={busy === `activate:${profile.id}`} onClick={() => void selectAccount(profile.id)}>Use this account</Button> : null}
            {removeCandidate === profile.id ? <div className="payout-remove-confirm"><p>Remove from future use?</p><Button variant="secondary" busy={busy === `remove:${profile.id}`} onClick={() => void removeAccount(profile.id)}>Yes, remove</Button><button type="button" onClick={() => setRemoveCandidate("")}>Keep account</button></div> : <button className="payout-remove-link" type="button" onClick={() => setRemoveCandidate(profile.id)}>Remove</button>}
          </div>
        </article>)}</div> : <Empty title="No receiving account yet" body="Add a bank or Mobile Money account, then verify it with Paystack." />}
      </section>
      {state.profiles.length > 0 && !state.active_profile ? <Notice tone="warning" title="Choose an account for new payments" body="Online rent payments remain unavailable until a verified account is selected." /> : null}
      {statusNote ? <Notice tone="info" title="Settlement account updated" body={statusNote} /> : null}
      {checking ? <Notice tone="info" title="Checking with Paystack" body="The first request may have completed. Rooomly is finding that exact setup before allowing another attempt." /> : null}
      {!checking && (showSetup || state.profiles.length === 0) ? <section className="payout-setup" aria-labelledby="payout-setup-title">
        <div><p className="type-label">ADD ACCOUNT</p><h2 id="payout-setup-title" className="type-title-1">Receiving details</h2></div>
        <div className="payout-methods" role="group" aria-label="Settlement account type">
          {(["bank", "mobile_money"] as const).map((value) => <button key={value} type="button" aria-pressed={method === value} onClick={() => { setMethod(value); setAccountNumber(""); setResolved(null); }}>{value === "bank" ? "Bank account" : "Mobile Money"}</button>)}
        </div>
        <Select label={method === "bank" ? "Bank" : "Network"} value={bankCode} onChange={(value) => { setBankCode(value); setResolved(null); }} options={institutionOptions} />
        <Field label={method === "bank" ? "Account number" : "Mobile Money number"} value={accountNumber} onChange={(event) => { setAccountNumber(event.target.value.replace(/\s/g, "")); setResolved(null); }} inputMode="numeric" autoComplete="off" hint="Used only to create the Paystack subaccount. Rooomly does not retain this number." />
        {method === "bank" && !resolved ? <Button variant="secondary" busy={busy === "resolve"} disabled={!bankCode || !accountNumber.trim()} onClick={() => void confirmAccount()}>Confirm account</Button> : null}
        {resolved ? <div className="payout-confirmed"><span aria-hidden="true">✓</span><div><strong>{resolved.account_name}</strong><p>{selectedInstitution?.name} · {resolved.masked_account}</p></div></div> : null}
        {(method === "mobile_money" || resolved) ? <div className="payout-save"><Button busy={busy === "save"} disabled={!bankCode || !accountNumber.trim()} onClick={() => void saveAccount()}>Add receiving account</Button><p className="type-caption">Property owners bear Paystack’s transaction fee. Adding or switching an account does not redirect payments already in progress.</p></div> : null}
      </section> : null}
    </> : null}
  </div>;
}
