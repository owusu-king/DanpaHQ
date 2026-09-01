"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { forwardRef, useId } from "react";

/**
 * Label above, hint below, error replacing the hint.
 *
 * The error is tied to the input with aria-describedby and announced politely,
 * because a validation message a screen reader never reaches is not a message.
 * Errors say what to do, never just what is wrong.
 *
 * The shell is what reacts, not the input: hovering, focusing and failing are
 * states of *the field*, and painting them on the input inside would leave the
 * border around it unmoved. It had no focus state at all — the input set
 * `outline: none` and nothing replaced it, so tabbing through a form moved a
 * cursor nobody could see. See `forms.css`.
 */
export const Field = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & {
    label: string;
    hint?: string;
    error?: string;
    prefix?: ReactNode;
  }
>(function Field({ label, hint, error, prefix, className, ...props }, ref) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  const shell = [
    "field-shell",
    error ? "field-shell-error" : "",
    props.disabled ? "field-shell-disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="field">
      <label htmlFor={id} className="type-caption field-label">
        {label}
      </label>

      <div className={shell}>
        {prefix ? <span className="type-body field-prefix">{prefix}</span> : null}
        <input
          {...props}
          ref={ref}
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={className ? `type-body field-input ${className}` : "type-body field-input"}
        />
      </div>

      {error ? (
        <span id={`${id}-error`} role="alert" className="type-caption field-error">
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-hint`} className="type-caption field-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
});
