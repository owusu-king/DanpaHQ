/**
 * The top of a portal page: what this is, and the actions that belong to it.
 *
 * Deliberately not the marketing header the public pages use. No eyebrow label,
 * no display-1, no lede paragraph selling the section someone has already
 * chosen to open — inside an application the title's job is orientation, and
 * anything larger is taking room from the work.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  /** One line, only where the page genuinely needs qualifying. */
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="portal-page-header">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="portal-page-actions">{actions}</div> : null}
    </header>
  );
}

/** A titled run of content. A rule and a heading, not a card. */
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="portal-section">
      <div className="portal-section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** "Empty screens are invitations, not apologies." */
export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="portal-empty">
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  );
}

/**
 * Loading that keeps the shape of what is coming.
 *
 * A row count rather than a spinner, so the page does not jump when the data
 * lands and there is something to read the layout from while it is in flight.
 */
export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="portal-skeleton-row" key={index}>
          <div className="portal-skeleton" style={{ width: "38%" }} />
          <div className="portal-skeleton" style={{ width: "62%", height: 12 }} />
        </div>
      ))}
    </div>
  );
}
