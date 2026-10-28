import Link from "next/link";

/** Stable entry point for the future electronic Ghana Card integration. */
export default function IdentityVerificationPage() {
  return <section className="verification-task" aria-labelledby="identity-verification-title">
    <Link href="/settings/verification" className="verification-back">← Verification</Link>
    <header className="verification-heading"><div>
      <h2 id="identity-verification-title">Biometric Identity Verification — Coming Soon</h2>
      <p>Electronic Ghana Card verification will be available here once the integration is ready.</p>
    </div></header>
    <button type="button" className="btn btn-secondary" disabled>Verify · Coming soon</button>
  </section>;
}
