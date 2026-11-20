"use client";

import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/portal/icons";

export type WizardStep = {
  key: string;
  label: string;
  icon: IconName;
  done: boolean;
  reachable: boolean;
};

export function StepProgress({ label, steps, current, onGo }: {
  label: string;
  steps: WizardStep[];
  current: string;
  onGo: (key: string) => void;
}) {
  return (
    <nav className="cw-progress" aria-label={label}>
      <ol>
        {steps.map((step) => {
          const active = step.key === current;
          return (
            <li key={step.key}>
              <button
                type="button"
                data-state={active ? "current" : step.done ? "done" : "upcoming"}
                aria-current={active ? "step" : undefined}
                aria-label={step.done && !active ? `${step.label}, complete` : step.label}
                title={step.label}
                disabled={active || !step.reachable}
                onClick={() => onGo(step.key)}
              >
                <span className="cw-checkpoint" aria-hidden="true"><Icon name={step.done && !active ? "check" : step.icon} /></span>
                <span className="cw-checkpoint-label">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function WizardShell({
  label, steps, current, onGo, context, footer, panels, dirty, onEdit, busy, children,
}: {
  label: string;
  steps: WizardStep[];
  current: string;
  onGo: (key: string) => void;
  context?: ReactNode;
  footer: ReactNode;
  panels: Record<string, ReactNode>;
  dirty: ReadonlySet<string>;
  onEdit: () => void;
  busy: boolean;
  children?: ReactNode;
}) {
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const lastStep = useRef(current);
  const wasBusy = useRef(busy);
  const at = steps.findIndex((step) => step.key === current);

  useEffect(() => {
    const finished = wasBusy.current && !busy;
    wasBusy.current = busy;
    if (finished) body.current?.querySelector<HTMLElement>(':scope > div:not([hidden]) [aria-invalid="true"]')?.focus();
  }, [busy]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      body.current?.querySelector<HTMLElement>(":scope > div:not([hidden]) :is(input:not([type=hidden]), select, textarea):enabled")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (lastStep.current === current) return;
    lastStep.current = current;
    if (body.current) body.current.scrollTop = 0;
    title.current?.focus({ preventScroll: true });
  }, [current]);

  return (
    <div className="cw-shell" data-step={current}>
      <StepProgress label={label} steps={steps} current={current} onGo={onGo} />
      <section className="cw-stage" aria-labelledby={titleId}>
        <div className="cw-stage-body" ref={body} aria-busy={busy || undefined}>
          <header className="cw-stage-heading">
            <h3 id={titleId} ref={title} tabIndex={-1}>{steps[at]?.label}</h3>
            <span>Step {at + 1} of {steps.length}</span>
            {context ? <p>{context}</p> : null}
          </header>
          {children}
          {steps.map(({ key }) => key === current || dirty.has(key) ? (
            <div
              key={key}
              hidden={key !== current}
              inert={busy}
              onChangeCapture={onEdit}
              onClickCapture={(event) => {
                if (event.target instanceof Element && event.target.closest("[role=radio]:not([aria-checked=true]), button[aria-pressed], .count-stepper button, [role=option]")) onEdit();
              }}
            >
              {panels[key]}
            </div>
          ) : null)}
        </div>
        <footer className="lw-foot cw-footer">{footer}</footer>
      </section>
    </div>
  );
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="cw-section"><h4>{title}</h4>{children}</section>;
}

/**
 * Pick one, drawn: a row of tiles, each with its glyph, name and a short line.
 *
 * Used for the property's water, power and compound, the Unit's type and the
 * property's category — choices of three to six where a dropdown hid the
 * options and wrapping chips lost their shape.
 */
export function ChoiceTiles({
  label,
  value,
  options,
  onChange,
  columns,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; hint?: string; icon: IconName }[];
  onChange: (value: string) => void;
  /** How many fit across on a wide stage; the grid wraps below that. */
  columns?: number;
  disabled?: boolean;
}) {
  return (
    <fieldset className="cw-choices">
      <legend className="lw-label">{label}</legend>
      <div
        className="cw-choice-grid"
        role="radiogroup"
        aria-label={label}
        style={columns ? ({ "--cw-columns": columns } as CSSProperties) : undefined}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className="cw-choice"
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            <span className="cw-choice-mark" aria-hidden="true"><Icon name={option.icon} /></span>
            <span className="cw-choice-copy">
              <strong>{option.label}</strong>
              {option.hint ? <small>{option.hint}</small> : null}
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** One line of a review: glyph, what it is, what was said, and the way back. */
export function ReviewLine({
  icon,
  term,
  value,
  tone,
  onEdit,
}: {
  icon: IconName;
  term: string;
  value: ReactNode;
  /** `todo` when this is still owed — the line says so in colour. */
  tone?: "todo";
  onEdit?: () => void;
}) {
  return (
    <div className="cw-review-line" data-tone={tone}>
      <span className="cw-review-mark" aria-hidden="true"><Icon name={icon} /></span>
      <dt>{term}</dt>
      <dd>{value}</dd>
      {onEdit ? (
        <button type="button" className="cw-review-edit" onClick={onEdit} aria-label={`Change ${term.toLowerCase()}`}>
          Change
        </button>
      ) : <span />}
    </div>
  );
}
