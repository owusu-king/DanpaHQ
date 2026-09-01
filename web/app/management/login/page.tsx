"use client";

import { FormEvent, useState } from "react";

import { Feedback } from "@/components/management/ManagementUI";
import { ManagementFailure, useManagement } from "@/lib/management";

export default function ManagementLoginPage() {
  const { login } = useManagement();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
    } catch (cause) {
      setError(cause instanceof ManagementFailure ? cause.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="management-login-page">
      <section className="management-login-story">
        <div>
          <span className="management-eyebrow" style={{ color: "#84caa4" }}>Restricted operations</span>
          <h1>Keep rental operations accountable.</h1>
          <p>
            Review people and properties carefully, help customers quickly, and leave a clear record of every sensitive decision.
          </p>
        </div>
        <small>Consumer phone sessions and Django Super Admin sessions cannot enter this portal.</small>
      </section>
      <section className="management-login-card-wrap" aria-label="Management sign in">
        <div className="management-login-card">
          <span className="management-eyebrow">Management Portal</span>
          <h2>Sign in</h2>
          <p>Use the email and password provisioned by a Super Admin.</p>
          <form className="management-form" onSubmit={submit}>
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
          </form>
        </div>
      </section>
    </main>
  );
}

