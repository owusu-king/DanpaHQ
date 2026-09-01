import type { Route } from "next";
import Link from "next/link";

import { EntryRedirect } from "@/components/EntryRedirect";

const TRUST_LEVELS = [
  ["Phone verified", "The person controls the registered phone number."],
  ["Identity verified", "A reviewer or approved provider confirmed who the person is."],
  ["Property verified", "The person's authority for that exact property was reviewed."],
] as const;

export default function Page() {
  return (
    <>
      <EntryRedirect />
      <main>
        <section
          style={{
            maxWidth: "72rem",
            minHeight: "70dvh",
            margin: "0 auto",
            padding: "var(--space-16) var(--space-5)",
            display: "grid",
            alignItems: "center",
            gap: "var(--space-10)",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 24rem), 1fr))",
          }}
        >
          <div>
            <p className="type-label" style={{ color: "var(--color-kola-600)" }}>
              VERIFIED RENTALS IN GHANA
            </p>
            <h1 className="type-display-1" style={{ margin: "var(--space-3) 0 var(--space-4)" }}>
              Find a place you can trust.
            </h1>
            <p className="type-body" style={{ color: "var(--color-ink-700)", maxWidth: "56ch" }}>
              Verified rental properties from verified owners and authorized agents across Ghana.
            </p>
            {/*
              Three journeys, and only one of them needs an account. "Find a
              property" goes straight to search as an anonymous visitor — no
              session, no tenant role, no workspace. The other two carry the
              chosen workspace through sign-in so the backend can put the person
              in the experience they asked for.
            */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)", marginTop: "var(--space-8)" }}>
              <Cta href="/rentals" primary>🔎 Find a property</Cta>
              <Cta href="/sign-in?workspace=tenant">🏠 I&apos;m a tenant</Cta>
              <Cta href="/sign-in?workspace=provider">🏢 I own/manage property</Cta>
            </div>
            {/*
              No sign-in link here. "I'm a tenant" and "I own/manage property"
              both lead to sign-in already, so a third link offering the same
              destination just asks the visitor to make the same decision twice.
              What is left is the one thing those two do not cover: not having an
              account yet.
            */}
            <p className="type-caption" style={{ marginTop: "var(--space-4)" }}>
              <Link href="/register">Don&apos;t have an account? Register now</Link>
            </p>
          </div>

          <div
            style={{
              padding: "var(--space-8)",
              background: "var(--color-kola-900)",
              color: "var(--color-field-0)",
              borderRadius: "var(--radius-lg)",
            }}
          >
            <p className="type-label" style={{ color: "var(--color-kola-300)" }}>THE STANDARD</p>
            <p className="type-title-1" style={{ margin: "var(--space-3) 0" }}>
              Easy to find a rental. Hard to fake a property.
            </p>
            <p className="type-body" style={{ color: "var(--color-field-200)", marginBottom: 0 }}>
              Browse without an account. Sign in only when you save, contact, apply, or list.
            </p>
          </div>
        </section>

        <section id="how-it-works" style={sectionStyle}>
          <p className="type-label">HOW IT WORKS</p>
          <h2 className="type-display-2">Start with the home, not a registration form.</h2>
          <div style={gridStyle}>
            <Step number="1" title="Browse freely" body="Search by place, price and property type. Open shared listing links immediately." />
            <Step number="2" title="See the trust" body="Every badge says whether the phone, identity, property or representative was checked." />
            <Step number="3" title="Continue when useful" body="Use one phone-and-code flow when you want to save, contact, apply or list." />
          </div>
        </section>

        <section id="trust" style={{ ...sectionStyle, background: "var(--color-field-0)" }}>
          <p className="type-label">TRUST &amp; VERIFICATION</p>
          <h2 className="type-display-2">Verified does not mean one vague thing.</h2>
          <div style={gridStyle}>
            {TRUST_LEVELS.map(([title, body]) => (
              <div key={title} style={cardStyle}>
                <p className="type-body-strong" style={{ marginTop: 0 }}>✓ {title}</p>
                <p className="type-caption" style={{ marginBottom: 0 }}>{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="help" style={sectionStyle}>
          <p className="type-label">HELP</p>
          <h2 className="type-title-1">Never send money because a badge looks reassuring.</h2>
          <p className="type-body" style={{ maxWidth: "62ch" }}>
            Read the exact badge, inspect the listing, arrange a recorded viewing and report anything
            that does not match. Private identity and ownership documents are never shown publicly.
          </p>
          <Link href="/rentals" style={{ color: "var(--color-kola-600)" }}>Browse verified rentals →</Link>
        </section>
      </main>
    </>
  );
}

function Cta({ href, primary = false, children }: { href: Route; primary?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="type-body-strong"
      style={{
        minHeight: "var(--target-min)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 var(--space-6)",
        borderRadius: "var(--radius-md)",
        background: primary ? "var(--color-kola-600)" : "var(--color-field-0)",
        color: primary ? "var(--color-field-0)" : "var(--color-ink-900)",
        border: "var(--border-hairline) solid var(--color-kola-600)",
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}

function Step({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div style={cardStyle}>
      <p className="type-label" style={{ color: "var(--color-kola-600)" }}>{number}</p>
      <h3 className="type-title-2">{title}</h3>
      <p className="type-caption">{body}</p>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  maxWidth: "72rem",
  margin: "0 auto",
  padding: "var(--space-16) var(--space-5)",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 17rem), 1fr))",
  gap: "var(--space-4)",
  marginTop: "var(--space-8)",
};

const cardStyle: React.CSSProperties = {
  padding: "var(--space-5)",
  background: "var(--color-field-0)",
  border: "var(--border-hairline) solid var(--color-field-200)",
  borderRadius: "var(--radius-md)",
};
