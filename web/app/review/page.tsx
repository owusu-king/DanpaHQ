import Link from "next/link";

export default function ReviewMovedPage() {
  return (
    <main style={{ maxWidth: "42rem", margin: "0 auto", padding: "var(--space-16) var(--space-5)" }}>
      <h1 className="type-display-2">Management</h1>
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
