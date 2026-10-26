"use client";

import { FormEvent, useEffect, useState } from "react";

import { Feedback, PageHeader, Panel, managementError, useNotice } from "@/components/management/ManagementUI";
import { managementFetch, useManagement } from "@/lib/management";

export default function ManagementProfilePage() {
  const { state, refresh } = useManagement();
  const notify = useNotice();
  const user = state.status === "signed_in" ? state.user : null;
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState<"" | "profile" | "password">("");
  const [profileError, setProfileError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => { if (user) { setFirstName(user.first_name); setLastName(user.last_name); } }, [user]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setBusy("profile");
    setProfileError("");
    try {
      await managementFetch("/profile/", { method: "PATCH", body: JSON.stringify({ first_name: firstName, last_name: lastName }) });
      await refresh();
      notify("success", "Profile updated.");
    } catch (cause) {
      setProfileError(managementError(cause, "Could not update your profile."));
    } finally {
      setBusy("");
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const next = String(form.get("new_password") || "");
    setPasswordError("");
    if (next !== form.get("confirm_password")) { setPasswordError("The new passwords do not match."); return; }
    setBusy("password");
    try {
      const response = await managementFetch<{ message: string }>("/profile/password/", { method: "POST", body: JSON.stringify({ current_password: form.get("current_password"), new_password: next }) });
      formElement.reset();
      notify("success", response.message);
    } catch (cause) {
      setPasswordError(managementError(cause, "Could not change the password."));
    } finally {
      setBusy("");
    }
  }

  if (!user) return null;
  const unchanged = firstName.trim() === user.first_name && lastName.trim() === user.last_name;

  return (
    <div className="management-narrow">
      <PageHeader
        title="Profile and security"
        description="Your role is assigned by a Super Admin. Changing your password signs out every Management session, including this one."
      />
      <Panel title="Your details">
        <form className="management-form" onSubmit={saveProfile}>
          <div className="management-form-grid">
            <label>First name<input value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" disabled={busy === "profile"} /></label>
            <label>Last name<input value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" disabled={busy === "profile"} /></label>
            <label>Work email<input value={user.email} disabled /><small>Set by a Super Admin.</small></label>
            <label>Role<input value={user.role_label} disabled /><small>Set by a Super Admin.</small></label>
          </div>
          <Feedback error={profileError} />
          <div className="management-form-actions">
            <button type="submit" className="management-button primary" disabled={busy !== "" || unchanged}>{busy === "profile" ? "Saving…" : "Save details"}</button>
          </div>
        </form>
      </Panel>
      <Panel title="Password">
        <form className="management-form" onSubmit={changePassword}>
          <input type="text" name="username" autoComplete="username" value={user.email} readOnly hidden />
          <label>Current password<input name="current_password" type="password" autoComplete="current-password" required disabled={busy === "password"} /></label>
          <div className="management-form-grid">
            <label>New password<input name="new_password" type="password" autoComplete="new-password" minLength={10} required disabled={busy === "password"} /></label>
            <label>Confirm new password<input name="confirm_password" type="password" autoComplete="new-password" minLength={10} required disabled={busy === "password"} /></label>
          </div>
          <p className="management-hint">At least 10 characters. Common and numbers-only passwords are refused.</p>
          <Feedback error={passwordError} />
          <div className="management-form-actions">
            <button type="submit" className="management-button primary" disabled={busy !== ""}>{busy === "password" ? "Changing…" : "Change password and sign out everywhere"}</button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
