"use client";

/**
 * A labelled select that meets the same 48px target rule as Field and Button.
 *
 * `appearance: none`, and the arrow is drawn in `forms.css`. The operating
 * system's own is the clearest tell that a control was never designed — it
 * cannot be recoloured, it differs on every platform, and it sat beside type
 * and colour chosen carefully enough to make the mismatch obvious.
 */
export function Select({
  label,
  value,
  onChange,
  options,
  hint,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
  hint?: string;
  /** Shown, and not changeable — for a value the backend will refuse. */
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span className="type-caption field-label">{label}</span>
      <span className={disabled ? "select-shell select-shell-disabled" : "select-shell"}>
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="type-body select-control"
        >
          {options.map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      </span>
      {hint ? <span className="type-caption field-hint">{hint}</span> : null}
    </label>
  );
}
