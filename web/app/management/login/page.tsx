"use client";

import { FormEvent, useState } from "react";

import { Feedback } from "@/components/management/ManagementUI";
import { MFAStep } from "@/components/auth/MFAStep";
import { isMFAChallenge, type MFAChallenge } from "@/lib/mfa";
import { ManagementFailure, useManagement } from "@/lib/management";

export default function ManagementLoginPage() {
  const { login, confirmMfa } = useManagement();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfa, setMfa] = useState<MFAChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await login(email, password);
      if (isMFAChallenge(result)) { setMfa(result); setPassword(""); }
    } catch (cause) {
      setError(cause instanceof ManagementFailure ? cause.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" tabIndex={-1} className="management-login-page">
      <section className="management-login-story">
        <div className="management-login-brand">
          <span className="management-brand-mark" aria-hidden="true">DH</span>
          <span>Danpa HQ Management</span>
        </div>
        <div>
          <h1>Keep rental operations accountable.</h1>
        </div>
      </section>
      <section className="management-login-card-wrap" aria-label="Management sign in">
        <div className="management-login-card">
          <h2>{mfa ? "Two-factor authentication" : "Sign in"}</h2>
          <p>{mfa ? "Enter the code from your authenticator app." : "Use your work email and password."}</p>
          {mfa ? <MFAStep initial={mfa} request={confirmMfa} onComplete={() => {}} onCancel={() => setMfa(null)} /> : <form className="management-form" onSubmit={submit}>
            <label>
              Work email
              <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              Password
              <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <Feedback error={error} />
            <button type="submit" className="management-button primary" disabled={busy}>
              {busy ? "Signing in…" : "Sign in to Management"}
            </button>
          </form>}
        </div>
      </section>
    </main>
  );
}
