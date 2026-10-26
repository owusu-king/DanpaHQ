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
  Panel,
  ResourceState,
  SearchField,
  Status,
  Toolbar,
  humanize,
  managementError,
  useNotice,
  useResource,
} from "@/components/management/ManagementUI";
import { managementFetch, useManagement } from "@/lib/management";

type Policy = "default" | "disabled" | "optional" | "required";
type Account = {
  id: string;
  account_kind: "consumer" | "management";
  display_name: string;
  email: string;
  phone: string;
  account_label: string;
  mfa_policy: Policy;
  effective_policy: Exclude<Policy, "default">;
  mfa_enrolled: boolean;
  is_active: boolean;
};
type Results = { results: Account[]; count: number; offset: number; limit: number };

const KINDS = [
  { value: "consumer", label: "Tenants and providers" },
  { value: "management", label: "Management team" },
] as const;

export function MFAConfiguration() {
  const { can } = useManagement();
  return can("manage_configuration") ? <MFAAccounts /> : null;
}

function MFAAccounts() {
  const { refresh } = useManagement();
  const notify = useNotice();
  const [kind, setKind] = useState<Account["account_kind"]>("consumer");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Account | null>(null);
  const resource = useResource<Results>(`/configuration/mfa/?account_kind=${kind}&q=${encodeURIComponent(query)}&offset=${offset}`);
  const data = resource.data;
  const busy = resource.loading || resource.refreshing;

  return (
    <Panel busy={resource.refreshing}>
      <Toolbar>
        <form
          className="management-search-form"
          role="search"
          onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); setOffset(0); }}
        >
          <SearchField label="Search accounts" placeholder="Name, email or phone" value={search} onChange={setSearch} />
          <button className="management-button" type="submit">Search</button>
        </form>
        <FilterTabs
          label="Accounts"
          value={kind}
          options={KINDS}
          onChange={(value) => { setKind(value); setOffset(0); }}
        />
      </Toolbar>
      <p className="management-hint" style={{ padding: ".75rem 1rem 0" }}>
        Optional offers setup during sign-in. Required blocks access until setup is complete. Enrolled accounts use authenticator codes while two-factor is on.
      </p>
      <ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} />
      {data && data.results.length ? (
        <DataTable label="MFA account policies">
          <thead><tr><th>Account</th><th>Policy</th><th>Authenticator</th><th className="is-end"><span className="sr-only">Action</span></th></tr></thead>
          <tbody>{data.results.map((account) => (
            <tr key={account.id}>
              <td><strong>{account.display_name}</strong><span className="management-subtext">{[account.email || account.phone, account.account_label, account.is_active ? "" : "Inactive"].filter(Boolean).join(" · ")}</span></td>
              <td>{account.mfa_policy === "default" ? `Default (${account.effective_policy})` : humanize(account.mfa_policy)}</td>
              <td><Status value={account.mfa_enrolled ? "active" : "neutral"} tone={account.mfa_enrolled ? "positive" : "neutral"} label={account.mfa_enrolled ? "Set up" : "Not set up"} /></td>
              <td className="is-end"><button type="button" className="management-button" onClick={() => setSelected(account)}>Edit policy</button></td>
            </tr>
          ))}</tbody>
        </DataTable>
      ) : data ? (
        <Empty icon="lock" message="No matching accounts." />
      ) : null}
      {data && data.count > data.limit ? (
        <div className="management-pagination">
          <span>{data.count} accounts · page {Math.floor(offset / data.limit) + 1} of {Math.max(1, Math.ceil(data.count / data.limit))}</span>
          <div className="management-actions">
            <button type="button" className="management-button" disabled={offset === 0 || busy} onClick={() => setOffset(Math.max(0, offset - data.limit))}>Previous</button>
            <button type="button" className="management-button" disabled={offset + data.limit >= data.count || busy} onClick={() => setOffset(offset + data.limit)}>Next</button>
          </div>
        </div>
      ) : null}
      {selected ? (
        <PolicyEditor account={selected} onCancel={() => setSelected(null)} onSaved={async (reauth, changed) => {
          setSelected(null);
          notify("success", changed ? "MFA policy saved. Existing sessions ended." : "MFA policy is unchanged.");
          if (reauth) await refresh(); else await resource.reload();
        }} />
      ) : null}
    </Panel>
  );
}

function PolicyEditor({ account, onCancel, onSaved }: {
  account: Account;
  onCancel: () => void;
  onSaved: (reauth: boolean, changed: boolean) => Promise<void>;
}) {
  const [policy, setPolicy] = useState<Policy>(account.mfa_policy);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <Drawer
      title={`Two-factor for ${account.display_name}`}
      meta={account.account_label || (account.account_kind === "management" ? "Management team" : "Tenant or provider")}
      onClose={onCancel}
      busy={busy}
      footer={<>
        <button type="submit" form="mfa-policy-editor" className="management-button primary" disabled={busy || reason.trim().length < 5 || policy === account.mfa_policy}>{busy ? "Saving…" : "Save MFA policy"}</button>
        <button type="button" className="management-button" disabled={busy} onClick={onCancel}>Cancel</button>
      </>}
    >
      <Facts>
        <Fact label="Current policy">{account.mfa_policy === "default" ? `Default (${account.effective_policy})` : humanize(account.mfa_policy)}</Fact>
        <Fact label="Authenticator">{account.mfa_enrolled ? "Set up" : "Not set up"}</Fact>
      </Facts>
      <form id="mfa-policy-editor" className="management-form" aria-label={`MFA for ${account.display_name}`} onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError("");
        try {
          const response = await managementFetch<{ changed: boolean; reauth_required: boolean }>("/configuration/mfa/", {
            method: "PATCH", body: JSON.stringify({ account_kind: account.account_kind, account_id: account.id, mfa_policy: policy, reason }),
          });
          await onSaved(response.reauth_required, response.changed);
        } catch (cause) { setError(managementError(cause, "Could not save the MFA policy.")); }
        finally { setBusy(false); }
      }}>
        <label>
          MFA policy
          <select value={policy} disabled={busy} onChange={(event) => setPolicy(event.target.value as Policy)}>
            <option value="default">Default ({account.account_kind === "management" ? "required" : "disabled"})</option>
            <option value="disabled">Disabled</option><option value="optional">Optional</option><option value="required">Required</option>
          </select>
        </label>
        <label>
          Reason
          <input value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={500} required disabled={busy} placeholder="Reason for this change" />
          <small>At least 5 characters. Kept in the audit log.</small>
        </label>
        <p className="management-hint">Changes end this account’s sessions. Its existing authenticator is retained. Changing your own policy requires signing in again.</p>
        <Feedback error={error} />
      </form>
    </Drawer>
  );
}
