"use client";

import { FormEvent, useEffect, useState } from "react";

import { Feedback, PageHeader, Panel } from "@/components/management/ManagementUI";
import { ManagementFailure, managementFetch, useManagement } from "@/lib/management";

export default function ManagementProfilePage() {
  const { state, refresh } = useManagement();
  const user = state.status === "signed_in" ? state.user : null;
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [feedback, setFeedback] = useState({ error: "", success: "" });

  useEffect(() => { if (user) { setFirstName(user.first_name); setLastName(user.last_name); } }, [user]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    try { await managementFetch("/profile/", { method: "PATCH", body: JSON.stringify({ first_name: firstName, last_name: lastName }) }); await refresh(); setFeedback({ error: "", success: "Profile updated." }); }
    catch (cause) { setFeedback({ error: cause instanceof ManagementFailure ? cause.message : "Could not update your profile.", success: "" }); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = String(form.get("new_password") || "");
    if (next !== form.get("confirm_password")) { setFeedback({ error: "The new passwords do not match.", success: "" }); return; }
    try { const response = await managementFetch<{ message: string }>("/profile/password/", { method: "POST", body: JSON.stringify({ current_password: form.get("current_password"), new_password: next }) }); setFeedback({ error: "", success: response.message }); }
    catch (cause) { setFeedback({ error: cause instanceof ManagementFailure ? cause.message : "Could not change the password.", success: "" }); }
  }

  if (!user) return null;
  return <><PageHeader eyebrow="Your access" title="Profile & security" description="Your role is assigned by a Super Admin. Password changes revoke every Management session, including this one." /><Feedback error={feedback.error} success={feedback.success} /><Panel title="Management identity"><form className="management-form" onSubmit={saveProfile}><div className="management-form-grid"><label>First name<input value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label><label>Last name<input value={lastName} onChange={(event) => setLastName(event.target.value)} /></label><label>Email<input value={user.email} disabled /></label><label>Role<input value={user.role_label} disabled /></label></div><div className="management-form-actions"><button className="management-button primary">Save profile</button></div></form></Panel><Panel title="Change password"><form className="management-form" onSubmit={changePassword}><label>Current password<input name="current_password" type="password" autoComplete="current-password" required /></label><div className="management-form-grid"><label>New password<input name="new_password" type="password" autoComplete="new-password" minLength={10} required /></label><label>Confirm new password<input name="confirm_password" type="password" autoComplete="new-password" minLength={10} required /></label></div><p className="management-subtext">Use at least 10 characters. Common and numeric-only passwords are refused by the server.</p><div className="management-form-actions"><button className="management-button primary">Change password and sign out everywhere</button></div></form></Panel></>;
}

