"use client";

import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
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
export function FieldFrame({ label, hint, error, required, id: givenId, children }: {
  label: ReactNode;
  hint?: string;
  error?: string;
  required?: boolean;
  id?: string;
  children: (id: string, description?: string) => ReactNode;
}) {
  const generatedId = useId();
  const id = givenId ?? generatedId;
  const description = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id} className="type-caption field-label">
        {label}{required ? <span className="field-required" aria-hidden="true"> *</span> : null}
      </label>
      {children(id, description)}
      {error ? <span id={description} role="alert" className="type-caption field-error">{error}</span>
        : hint ? <span id={description} className="type-caption field-hint">{hint}</span> : null}
    </div>
  );
}

export const Field = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> & {
    label: ReactNode;
    hint?: string;
    error?: string;
    prefix?: ReactNode;
    action?: ReactNode;
  }
>(function Field({ label, hint, error, prefix, action, className, id, ...props }, ref) {
  const shell = [
    "field-shell",
    error ? "field-shell-error" : "",
    props.disabled ? "field-shell-disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <FieldFrame label={label} hint={hint} error={error} required={props.required} id={id}>
      {(controlId, describedBy) => <div className={shell}>
        {prefix ? <span className="type-body field-prefix">{prefix}</span> : null}
        <input
          {...props}
          ref={ref}
          id={controlId}
          aria-invalid={error ? true : props["aria-invalid"]}
          aria-describedby={[props["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined}
          className={className ? `type-body field-input ${className}` : "type-body field-input"}
        />
        {action}
      </div>}
    </FieldFrame>
  );
});

export function Textarea({ label, hint, error, id, className, ...props }:
  TextareaHTMLAttributes<HTMLTextAreaElement> & { label: ReactNode; hint?: string; error?: string }) {
  return (
    <FieldFrame label={label} hint={hint} error={error} required={props.required} id={id}>
      {(controlId, describedBy) => (
        <textarea {...props} id={controlId} aria-invalid={error ? true : props["aria-invalid"]}
          aria-describedby={[props["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined}
          className={["type-body", "field-textarea", className].filter(Boolean).join(" ")} />
      )}
    </FieldFrame>
  );
}
