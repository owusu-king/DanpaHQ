import type { ReactNode } from "react";

/**
 * One concern in a Settings panel: a quiet header — the title, one line of
 * what it is for, and at most one action — over the content that changes it.
 * Every panel builds from this, so Settings reads the same way throughout.
 */
export function SettingsCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`settings-card${className ? ` ${className}` : ""}`}>
      <header className="settings-card-head">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action ? <div className="settings-card-action">{action}</div> : null}
      </header>
      <div className="settings-card-body">{children}</div>
    </section>
  );
}
