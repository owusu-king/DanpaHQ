"use client";

import type { ReactNode } from "react";

/**
 * A box you tick, and a circle you fill.
 *
 * Neither existed. Nine screens hand-rolled `<input type="checkbox">` and
 * `<input type="radio">` with no styling at all, so the operating system drew
 * them — in its own grey, at its own size, with its own focus ring — beside
 * type and colour the rest of the product chose deliberately.
 *
 * The real input is still here and still does all the work: it carries the
 * semantics, the keyboard behaviour, the announced state, and the grouping that
 * makes arrow keys move between radios in a set. It is only unpainted. What you
 * see is a span next to it that reacts through `:checked` and `:focus-visible`,
 * which is why this is drawn in `forms.css` and not inline — an inline style
 * cannot express a pseudo-class.
 *
 * The whole row is the label, so the text is part of the target rather than
 * something to aim past on the way to a 20px square.
 */
function Control({
  kind,
  checked,
  onChange,
  label,
  note,
  disabled = false,
  name,
}: {
  kind: "checkbox" | "radio";
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  /** A second line, where the choice needs one. Most do not. */
  note?: ReactNode;
  disabled?: boolean;
  /** Radios only: what makes a set a set. */
  name?: string;
}) {
  return (
    <label className={disabled ? "control control-disabled" : "control"}>
      <input
        type={kind}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="control-input"
      />
      <span
        aria-hidden
        className={kind === "radio" ? "control-box control-box-radio" : "control-box"}
      />
      <span className="control-what">
        <span className="type-body control-title">{label}</span>
        {note ? <span className="type-caption control-note">{note}</span> : null}
      </span>
    </label>
  );
}

export function Check(props: Omit<Parameters<typeof Control>[0], "kind" | "name">) {
  return <Control {...props} kind="checkbox" />;
}

export function Radio(props: Omit<Parameters<typeof Control>[0], "kind">) {
  return <Control {...props} kind="radio" />;
}

/**
 * One of a set you can pick several from — an amenity, an attribute.
 *
 * Same input, same semantics, drawn as a pill instead of a box and a line of
 * text. These used to be a chip with a native checkbox inside it, which said
 * "selected" twice and let the operating system draw one of the two.
 */
export function CheckChip({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="type-body chip">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="control-input"
      />
      {label}
    </label>
  );
}

/**
 * A setting that is on or off.
 *
 * Rendered as the caller's own row — settings rows put the text on the left and
 * the control on the right — so this is only the control, not the label. The
 * input still carries `role="switch"` semantics through its checked state.
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Named for a screen reader, since the visible text belongs to the row. */
  label?: string;
}) {
  return (
    <>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="control-input"
      />
      <span aria-hidden className="switch" />
    </>
  );
}
