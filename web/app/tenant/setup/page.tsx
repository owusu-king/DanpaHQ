"use client";

import Link from "next/link";

import { JoinHomeForm } from "@/components/tenant/JoinHome";

/**
 * A direct link's way into joining a home. From Home this opens as a small
 * modal (`JoinHomeButton`); both are the same form — I have a Unit access
 * code, find the space, send a tenancy request.
 */
export default function TenantSetupPage() {
  return (
    <main style={{ maxWidth: "30rem", margin: "0 auto", padding: "var(--space-10) var(--space-5)", display: "grid", gap: "var(--space-5)" }}>
      <header style={{ display: "grid", gap: "var(--space-2)" }}>
        <h1 className="type-title-1" style={{ margin: 0 }}>Join a home</h1>
        <p className="type-caption" style={{ margin: 0 }}>Use the code from your landlord.</p>
      </header>
      <JoinHomeForm />
      <Link href="/home" className="type-caption" style={{ color: "var(--color-kola-600)" }}>← Back to Home</Link>
    </main>
  );
}
