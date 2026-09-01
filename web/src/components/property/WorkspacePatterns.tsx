import Link from "next/link";

import type {
  Property,
  SpaceAvailability,
  SpacePublication,
  SpaceVerification,
} from "@/lib/console";

export type StatusTone = "neutral" | "good" | "waiting" | "attention";

export function StatusLine({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: StatusTone;
}) {
  return (
    <span className="status-line" data-tone={tone}>
      <span className="status-line-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function propertyStatus(property: Pick<Property, "verification">): {
  label: string;
  tone: StatusTone;
} {
  const state = property.verification.review_state;
  if (state === "verified") return { label: "Verified", tone: "good" };
  if (state === "pending_verification") return { label: "Verification in progress", tone: "waiting" };
  if (["changes_required", "rejected", "suspended", "expired"].includes(state)) {
    return { label: property.verification.review_state_label, tone: "attention" };
  }
  if (state === "withdrawn") return { label: "Verification withdrawn", tone: "waiting" };
  return {
    label: property.verification.state === "draft" ? "Setup incomplete" : "Not submitted",
    tone: "neutral",
  };
}

export function spaceStatus({
  verification,
  publication,
  availability,
}: {
  verification: SpaceVerification;
  publication: SpacePublication;
  availability: SpaceAvailability;
}): { label: string; tone: StatusTone } {
  if (availability.state === "occupied") {
    return { label: "Occupied", tone: "neutral" };
  }
  if (["changes_requested", "rejected", "suspended", "expired"].includes(verification.state)) {
    return { label: verification.state_label, tone: "attention" };
  }
  if (verification.state === "submitted" || verification.state === "under_review") {
    return { label: "Verification in progress", tone: "waiting" };
  }
  if (verification.state !== "verified") {
    return { label: verification.state_label, tone: "neutral" };
  }
  return {
    label: publication.state === "published" ? "Verified · Public · Available" : "Verified · Available",
    tone: "good",
  };
}

export function EntityPath({
  items,
}: {
  items: Array<{ label: string; href?: string; mobileLabel?: string }>;
}) {
  const mobileBackIndex = items.reduce(
    (last, item, index) => (item.href ? index : last),
    -1,
  );

  return (
    <nav className="entity-path" aria-label="Breadcrumb">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="entity-path-entry">
          {index ? <span className="entity-path-separator" aria-hidden="true">/</span> : null}
          <span
            className="entity-path-item"
            data-mobile-back={index === mobileBackIndex ? "true" : undefined}
          >
            {item.href ? (
              <Link
                href={item.href as never}
                aria-label={
                  index === mobileBackIndex && item.mobileLabel
                    ? item.mobileLabel
                    : undefined
                }
              >
                <span className="entity-path-label">{item.label}</span>
                <span className="entity-path-mobile-label">
                  {item.mobileLabel ?? item.label}
                </span>
              </Link>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
          </span>
        </span>
      ))}
    </nav>
  );
}

export function EntityHeader({
  eyebrow,
  title,
  subtitle,
  status,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  status?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="entity-header">
      <div className="entity-header-copy">
        {eyebrow ? <span className="entity-kicker">{eyebrow}</span> : null}
        <h1 className="entity-title">{title}</h1>
        {subtitle ? <p className="entity-subtitle">{subtitle}</p> : null}
        {status ? <div style={{ marginTop: "var(--space-3)" }}>{status}</div> : null}
      </div>
      {actions ? <div className="entity-header-actions">{actions}</div> : null}
    </header>
  );
}

export function DetailDisclosure({
  title,
  children,
  open = false,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details className="detail-disclosure" open={open}>
      <summary>{title}</summary>
      <div className="detail-disclosure-body">{children}</div>
    </details>
  );
}
