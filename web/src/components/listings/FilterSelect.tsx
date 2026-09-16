"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * A browse filter, on the shadcn select.
 *
 * The native control could not be made to match the rest of the page: its
 * menu is drawn by the operating system, so the type, the radius, the hover
 * and the selected state are all whatever the platform decided, sitting inside
 * a page where every one of those was chosen. This is a listbox the product
 * actually owns.
 *
 * The tuple options API is deliberately the same as the native version it
 * replaces, so the call sites did not have to change shape.
 *
 * Radix's trigger is a button, not a form control, so a wrapping `<label>`
 * would associate with nothing. The label is a sibling with an id, and the
 * trigger points at it — which is what makes the control announce as
 * "Bedrooms, Any bedrooms" rather than just its value.
 */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  hideLabel = false,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
  /** For a control whose meaning is already obvious from its value. */
  hideLabel?: boolean;
  className?: string;
}) {
  const id = `filter-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <div className={cn("grid min-w-0 gap-2", className)}>
      <span id={id} className={cn("text-sm font-medium text-muted-foreground", hideLabel && "sr-only")}>
        {label}
      </span>
      {/*
        Radix treats "" as "nothing is selected", which is exactly what the
        empty option means here — "Any bedrooms". So the empty string is mapped
        to a sentinel on the way in and back to "" on the way out, letting the
        placeholder do the work without inventing a filter value the backend
        would have to understand.
      */}
      <Select
        value={value === "" ? ANY : value}
        onValueChange={(next) => onChange(next === ANY ? "" : next)}
      >
        <SelectTrigger
          aria-labelledby={id}
          className="h-14 w-full rounded-full border-input bg-background px-5 text-[0.9375rem] data-[placeholder]:text-muted-foreground"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="rounded-2xl">
          {options.map(([key, text]) => (
            <SelectItem key={key || ANY} value={key || ANY} className="rounded-xl py-2.5">
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Stands in for the empty option, which Radix reserves to mean "unset". */
const ANY = "__any__";
