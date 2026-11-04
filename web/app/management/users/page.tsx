"use client";

import Link from "next/link";
import { useState } from "react";

import {
  DataTable,
  Drawer,
  Empty,
  Fact,
  Facts,
  FilterTabs,
  Feedback,
  PageHeader,
  Panel,
  ResourceState,
  SearchField,
  Status,
  Toolbar,
  countMeta,
  managementError,
  matches,
  useNotice,
  useQueryState,
  useResource,
} from "@/components/management/ManagementUI";
import { formatDate, managementFetch, useManagement } from "@/lib/management";

type UserRow = { id: string; display_name: string; phone: string; email: string; roles: string[]; is_phone_verified: boolean; is_active: boolean; onboarding_complete: boolean; created_at: string; last_seen_at: string | null };

const STATES = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Deactivated" },
  { value: "unverified", label: "Phone unverified" },
] as const;

export default function UsersPage() {
  const { can } = useManagement();
  const notify = useNotice();
  const resource = useResource<{ results: UserRow[] }>("/users/");
  const [query, setQuery] = useQueryState("q");
  const [state, setState] = useQueryState("state");
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function setActive(active: boolean) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await managementFetch(`/users/${selected.id}/status/`, { method: "POST", body: JSON.stringify({ active, reason }) });
      notify("success", active ? `${selected.display_name}'s account was reactivated.` : `${selected.display_name}'s account was deactivated and their sessions revoked.`);
      setSelected(null);
      setReason("");
      await resource.reload();
    } catch (cause) {
      setError(managementError(cause, "Could not update this account."));
    } finally {
      setBusy(false);
    }
  }

  const all = resource.data?.results ?? [];
  const rows = all.filter((user) => (
    matches(query, user.display_name, user.phone, user.email, user.roles.join(" "))
    && (state === "active" ? user.is_active : state === "inactive" ? !user.is_active : state === "unverified" ? !user.is_phone_verified : true)
  ));

  return (
    <>
      <PageHeader
        title="Users"
        actions={can("manage_configuration") ? <Link className="management-button" href="/management/configuration?section=mfa">Two-factor settings</Link> : null}
      />
      <Panel title="Accounts" meta={resource.data ? countMeta(rows.length, all.length, ["account", "accounts"]) : undefined}>
        <Toolbar>
          <SearchField label="Filter accounts" placeholder="Name, phone, email or role" value={query} onChange={setQuery} />
          <FilterTabs label="Account state" value={state} options={STATES} onChange={setState} />
        </Toolbar>
        <ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} />
        {resource.data && rows.length ? (
          <DataTable label="Consumer accounts">
            <thead><tr><th>Person</th><th>Roles</th><th>Phone</th><th>Onboarding</th><th>Account</th><th>Last active</th><th className="is-end"><span className="sr-only">Action</span></th></tr></thead>
            <tbody>{rows.map((user) => (
              <tr key={user.id}>
                <td><strong>{user.display_name}</strong><span className="management-subtext">{user.phone}{user.email ? ` · ${user.email}` : ""}</span></td>
                <td>{user.roles.length ? user.roles.map((role) => role.replaceAll("_", " ")).join(", ") : "No role yet"}</td>
                <td><Status value={user.is_phone_verified ? "verified" : "unverified"} label={user.is_phone_verified ? "Verified" : "Unverified"} /></td>
                <td><Status value={user.onboarding_complete ? "complete" : "incomplete"} label={user.onboarding_complete ? "Complete" : "Not finished"} /></td>
                <td><Status value={user.is_active} label={user.is_active ? "Active" : "Deactivated"} /></td>
                <td className="is-date">{formatDate(user.last_seen_at || user.created_at)}</td>
                <td className="is-end">
                  <button type="button" className="management-button" onClick={() => { setSelected(user); setReason(""); setError(""); }}>Open</button>
                </td>
              </tr>
            ))}</tbody>
          </DataTable>
        ) : resource.data ? (
          <Empty icon="users" message={all.length ? "No accounts match this filter." : "No consumer accounts yet."} />
        ) : null}
      </Panel>

      {selected ? (
        <Drawer
          title={selected.display_name}
          meta={selected.roles.length ? selected.roles.map((role) => role.replaceAll("_", " ")).join(", ") : "No role yet"}
          onClose={() => setSelected(null)}
          busy={busy}
          footer={can("manage_users") ? (
            <>
              <button
                type="button"
                className={`management-button ${selected.is_active ? "danger solid" : "primary"}`}
                disabled={busy}
                onClick={() => void setActive(!selected.is_active)}
              >
                {busy ? "Saving…" : selected.is_active ? "Deactivate account" : "Reactivate account"}
              </button>
              <button type="button" className="management-button" disabled={busy} onClick={() => setSelected(null)}>Cancel</button>
            </>
          ) : undefined}
        >
          <Facts>
            <Fact label="Phone">{selected.phone || "—"}</Fact>
            <Fact label="Email">{selected.email || "—"}</Fact>
            <Fact label="Phone check"><Status value={selected.is_phone_verified ? "verified" : "unverified"} label={selected.is_phone_verified ? "Verified" : "Unverified"} /></Fact>
            <Fact label="Onboarding">{selected.onboarding_complete ? "Complete" : "Not finished"}</Fact>
            <Fact label="Joined">{formatDate(selected.created_at)}</Fact>
            <Fact label="Last active">{formatDate(selected.last_seen_at)}</Fact>
          </Facts>
          {can("manage_users") ? (
            <div className="management-form">
              <p className="management-hint">
                {selected.is_active
                  ? "Deactivating signs them out everywhere and stops them signing in. Their records stay."
                  : "Reactivating lets them sign in again with their existing account."}
              </p>
              <label>
                Decision note
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Enter a reason suitable for the customer and audit log." disabled={busy} />
              </label>
              <Feedback error={error} />
            </div>
          ) : (
            <p className="management-hint">Your role can read this account. Changing it needs the account management permission.</p>
          )}
        </Drawer>
      ) : null}
    </>
  );
}
