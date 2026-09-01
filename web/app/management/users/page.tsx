"use client";

import { useState } from "react";

import { DataTable, Feedback, PageHeader, Panel, ResourceState, Status, useResource } from "@/components/management/ManagementUI";
import { ManagementFailure, formatDate, managementFetch, useManagement } from "@/lib/management";

type UserRow = { id: string; display_name: string; phone: string; email: string; roles: string[]; is_phone_verified: boolean; is_active: boolean; onboarding_complete: boolean; created_at: string; last_seen_at: string | null };

export default function UsersPage() {
  const { can } = useManagement();
  const resource = useResource<{ results: UserRow[] }>("/users/");
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function setActive(active: boolean) {
    if (!selected) return;
    setError("");
    setMessage("");
    try {
      await managementFetch(`/users/${selected.id}/status/`, { method: "POST", body: JSON.stringify({ active, reason }) });
      setMessage(active ? "Account reactivated." : "Account deactivated and live sessions revoked.");
      setSelected(null);
      setReason("");
      await resource.reload();
    } catch (cause) {
      setError(cause instanceof ManagementFailure ? cause.message : "Could not update this account.");
    }
  }

  return (
    <>
      <PageHeader eyebrow="Consumer accounts" title="Users" description="Find account context, confirm onboarding and phone state, and take controlled account action when necessary." />
      <Feedback error={error || resource.error} success={message} />
      <ResourceState loading={resource.loading} error="" />
      <Panel title="Accounts" meta={`${resource.data?.results.length ?? 0} shown`}>
        <DataTable label="Consumer accounts">
          <thead><tr><th>User</th><th>Roles</th><th>Trust & onboarding</th><th>Account</th><th>Last activity</th><th>Action</th></tr></thead>
          <tbody>{resource.data?.results.map((user) => (
            <tr key={user.id}>
              <td><strong>{user.display_name}</strong><span className="management-subtext">{user.phone}{user.email ? ` · ${user.email}` : ""}</span></td>
              <td>{user.roles.join(", ") || "No role"}</td>
              <td><Status value={user.is_phone_verified ? "verified" : "unverified"} /> <Status value={user.onboarding_complete ? "complete" : "incomplete"} /></td>
              <td><Status value={user.is_active} /></td>
              <td>{formatDate(user.last_seen_at || user.created_at)}</td>
              <td>{can("manage_users") ? <button className="management-button" onClick={() => { setSelected(user); setReason(""); }}>{user.is_active ? "Deactivate" : "Reactivate"}</button> : <span className="management-subtext">Read only</span>}</td>
            </tr>
          ))}</tbody>
        </DataTable>
      </Panel>
      {selected ? (
        <Panel title={`${selected.is_active ? "Deactivate" : "Reactivate"} ${selected.display_name}`}>
          <div className="management-form">
            <label>Decision note<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Record the customer-safe operational reason." /></label>
            <div className="management-form-actions">
              <button className={`management-button ${selected.is_active ? "danger" : "primary"}`} onClick={() => void setActive(!selected.is_active)}>{selected.is_active ? "Deactivate account" : "Reactivate account"}</button>
              <button className="management-button" onClick={() => setSelected(null)}>Cancel</button>
            </div>
          </div>
        </Panel>
      ) : null}
    </>
  );
}

