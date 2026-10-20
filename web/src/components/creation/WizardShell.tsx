"use client";

/**
 * The frame a creation flow walks in: a rail of steps, the step, one footer.
 *
 * The agreement wizard's layout (owner, 2026-10-20: "in a modal, like agreement
 * creation"), shared by creating a Property and creating a Unit so the two feel
 * like one product. What differs from the agreement rail is the mark: every step
 * keeps its own glyph, and a finished one turns kola green behind it rather than
 * swapping the glyph for a tick — a column of identical ticks says nothing about
 * which step is which.
 *
 * Steps decide nothing here. Each flow says which steps it has, which are done
 * and which may be opened; this draws that and reports where somebody pressed.
 */

import type { CSSProperties, ReactNode } from "react";

import { Icon, type IconName } from "@/components/portal/icons";

export type WizardStep = {
  key: string;
  label: string;
  /** One line under the stage title. */
  hint: string;
  icon: IconName;
  /** What was chosen there, said back on the rail. */
  summary?: string;
  done: boolean;
  /** Whether pressing it on the rail opens it. */
  reachable: boolean;
};

export function WizardShell({
  label,
  steps,
  current,
  onGo,
  railFoot,
  footer,
  children,
}: {
  /** Names the rail for assistive technology, e.g. "Property steps". */
  label: string;
  steps: WizardStep[];
  current: string;
  onGo: (key: string) => void;
  railFoot?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const at = Math.max(0, steps.findIndex((step) => step.key === current));
  const step = steps[at] ?? steps[0]!;

  return (
    <div className="lw is-iconic" data-step={step.key}>
      <nav className="lw-rail" aria-label={label}>
        <ol>
          {steps.map((item) => {
            const state = item.key === step.key ? "current" : item.done ? "done" : "todo";
            return (
              <li key={item.key}>
                <button
                  type="button"
                  className="lw-rail-step"
                  data-state={state}
                  aria-current={item.key === step.key ? "step" : undefined}
                  disabled={!item.reachable}
                  onClick={() => onGo(item.key)}
                >
                  <span className="lw-rail-mark" aria-hidden="true">
                    <Icon name={item.icon} />
                  </span>
                  <span className="lw-rail-copy">
                    <strong>{item.label}</strong>
                    <small>{item.summary || (item.done ? "Done" : state === "current" ? "Now" : "To do")}</small>
                  </span>
                  {item.done ? <span className="sr-only">, done</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
        {railFoot ? <p className="lw-rail-foot">{railFoot}</p> : null}
      </nav>

      <section className="lw-stage" aria-labelledby="wizard-step-title">
        <header className="lw-stage-head">
          <span className="lw-stage-count">Step {at + 1} of {steps.length}</span>
          <h3 id="wizard-step-title">{step.label}</h3>
          <p>{step.hint}</p>
          <span className="lw-progress" aria-hidden="true">
            <i style={{ width: `${((at + 1) / steps.length) * 100}%` }} />
          </span>
        </header>

        <div className="lw-stage-body" key={step.key}>
          {children}
        </div>

        <footer className="lw-foot">{footer}</footer>
      </section>
    </div>
  );
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
}: {
  label: string;
  value: string;
  options: { value: string; label: string; hint?: string; icon: IconName }[];
  onChange: (value: string) => void;
  /** How many fit across on a wide stage; the grid wraps below that. */
  columns?: number;
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
