"use client";

/**
 * A short, coloured statement of something the user needs to know.
 *
 * Errors get role="alert" so a screen reader announces them without the user
 * having to go looking. The wording rule from the design system applies: say
 * what to do next, not only what went wrong.
 */
export function Notice({
  tone = "info",
  title,
  body,
}: {
  tone?: "info" | "error" | "success" | "warning";
  title: string;
  body?: string;
}) {
  const palette = {
    info: ["var(--color-lagoon-100)", "var(--color-lagoon-600)"],
    error: ["var(--color-laterite-100)", "var(--color-laterite-600)"],
    success: ["var(--color-kola-50)", "var(--color-kola-600)"],
    warning: ["var(--color-harmattan-100)", "var(--color-harmattan-500)"],
  }[tone];

  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      style={{
        marginTop: "var(--space-4)",
        padding: "var(--space-4)",
        background: palette[0],
        borderLeft: `var(--border-stamp) solid ${palette[1]}`,
        borderRadius: "var(--radius-stamp)",
      }}
    >
      <p className="type-body-strong" style={{ margin: 0 }}>
        {title}
      </p>
      {body ? (
        <p className="type-caption" style={{ margin: "var(--space-2) 0 0" }}>
          {body}
        </p>
      ) : null}
    </div>
  );
}
