"use client";

import {
  Select as Listbox,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * A labelled select the product actually owns.
 *
 * This used to be a native `<select>` with `appearance: none` and a chevron
 * drawn in `forms.css`. That gets the *closed* control to match the page and
 * can do nothing at all about the open one: the menu is drawn by the operating
 * system, so its type, radius, row height, hover and selected state are
 * whatever the platform decided — a grey Aqua popup dropping out of a control
 * built from tokens. Half a designed control is the tell, not the fix.
 *
 * Radix draws both halves. The props are unchanged, so all twelve call sites
 * kept working without edits.
 *
 * The label is a sibling with an id rather than a wrapping `<label>`: the
 * trigger is a button, not a form control, and a label wrapping it associates
 * with nothing. `aria-labelledby` is what makes it announce as "Region,
 * Greater Accra" instead of just its value.
 */
export function Select({
  label,
  value,
  onChange,
  options,
  hint,
  disabled = false,
  /** A toolbar control, where the field's 48px and its own label are too much. */
  compact = false,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
  hint?: string;
  /** Shown, and not changeable — for a value the backend will refuse. */
  disabled?: boolean;
  compact?: boolean;
  /** For a caller that owns where the control sits in its own layout. */
  className?: string;
}) {
  const id = `select-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <div className={cn("grid min-w-0", compact ? "gap-1" : "gap-2", className)}>
      <span
        id={id}
        className={cn(
          "field-label",
          compact ? "text-xs font-medium text-muted-foreground" : "type-caption",
        )}
      >
        {label}
      </span>
      {/*
        Radix reserves "" to mean "nothing is selected", and two call sites —
        the optional income band on an application, and "Not in a named block"
        when adding a Unit — offer an option whose value genuinely is "". An
        empty `SelectItem` value throws, so it is mapped to a sentinel on the
        way in and back on the way out, exactly as `FilterSelect` does.
      */}
      <Listbox
        value={value === "" ? UNSET : value}
        onValueChange={(next) => onChange(next === UNSET ? "" : next)}
        disabled={disabled}
      >
        <SelectTrigger
          aria-labelledby={id}
          /* Both variants stand 48px, the product's target minimum. `compact`
             buys its density from a smaller label and tighter padding — not
             from the height, which is the one dimension a thumb cares about. */
          className={cn(
            "h-12 w-full rounded-xl border-input bg-background",
            compact ? "px-3 text-sm" : "px-4 text-[0.9375rem]",
          )}
        >
          <SelectValue />
        </SelectTrigger>
        {/*
          Below the trigger, not over it. Radix's default places the menu so the
          selected row sits on top of the control — which puts the trigger's own
          focus ring around that first row, reading as a stray box inside the
          menu. Dropping it is also the plainer motion: the list comes from the
          thing you pressed.
        */}
        <SelectContent position="popper" sideOffset={6} className="rounded-2xl border-border shadow-lg">
          {options.map(([key, text]) => (
            <SelectItem key={key || UNSET} value={key || UNSET} className="rounded-xl py-2.5">
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Listbox>
      {hint ? <span className="type-caption field-hint">{hint}</span> : null}
    </div>
  );
}

/** Stands in for an option whose value is "", which Radix reserves. */
const UNSET = "__unset__";
