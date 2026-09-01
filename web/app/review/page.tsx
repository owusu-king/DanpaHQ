import Link from "next/link";

export default function ReviewMovedPage() {
  return (
    <main style={{ maxWidth: "42rem", margin: "0 auto", padding: "var(--space-16) var(--space-5)" }}>
      <p className="type-label">MANAGEMENT</p>
      <h1 className="type-display-2">Administration is separate from the consumer product.</h1>
      <p className="type-body">
        Verification review is not available through a phone-authenticated consumer session.
        Operations and Support Admins use a provisioned email and password in the Management
        Portal. Django Admin is reserved for Super Admins.
      </p>
      <Link
        href={"/management/login" as never}
        className="type-body-strong"
        style={{ color: "var(--color-kola-600)" }}
      >
        Open the Management Portal →
      </Link>
    </main>
  );
}
