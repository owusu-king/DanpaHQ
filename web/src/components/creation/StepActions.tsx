"use client";

import type { ReactNode } from "react";

/**
 * One button and a few quiet links: the end of every creation step.
 *
 * A step used to end in four bordered buttons — continue, skip, back, save for
 * later — all asking for the same attention (owner, 2026-10-05: "really bad
 * design"). Only moving forward is a button; the rest are links.
 */
export function StepActions({
  primary,
  links,
}: {
  primary?: ReactNode;
  links: ({ label: string; onClick: () => void; disabled?: boolean } | null | false)[];
}) {
  return (
    <div className="step-actions">
      {primary}
      {links.filter(Boolean).map((link) =>
        link ? (
          <button
            key={link.label}
            type="button"
            className="step-link"
            onClick={link.onClick}
            disabled={link.disabled}
          >
            {link.label}
          </button>
        ) : null,
      )}
    </div>
  );
}

/** A small number with − and +: bedrooms, bathrooms, a floor. */
export function CountStepper({
  label,
  value,
  onChange,
  min = 0,
  max = 20,
  format,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  /** How the number reads, e.g. 0 → "Ground". */
  format?: (value: number) => string;
}) {
  return (
    <div className="count-stepper" role="group" aria-label={label}>
      <span className="type-caption count-stepper-label">{label}</span>
      <div className="count-stepper-control">
        <button
          type="button"
          aria-label={`Fewer: ${label}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          −
        </button>
        <output aria-live="polite" data-word={format && Number.isNaN(Number(format(value))) ? "" : undefined}>
          {format ? format(value) : value}
        </output>
        <button
          type="button"
          aria-label={`More: ${label}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          +
        </button>
      </div>
    </div>
  );
}

/** A yes/no question that a count would overstate: "Own bathroom?" */
export function YesNo({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="count-stepper" role="radiogroup" aria-label={label}>
      <span className="type-caption count-stepper-label">{label}</span>
      <div className="yes-no">
        {([true, false] as const).map((option) => (
          <button
            key={String(option)}
            type="button"
            role="radio"
            aria-checked={value === option}
            onClick={() => onChange(option)}
          >
            {option ? "Yes" : "No"}
          </button>
        ))}
      </div>
    </div>
  );
}
