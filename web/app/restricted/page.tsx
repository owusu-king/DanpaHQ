export default function RestrictedPage() {
  return (
    <div style={{ maxWidth: "38rem", margin: "0 auto", padding: "var(--space-16) var(--space-5)" }}>
      <h1 className="type-display-2">Account access is limited</h1>
      <p className="type-body">You are signed in, but this account cannot use a workspace right now. Contact support.</p>
    </div>
  );
}
