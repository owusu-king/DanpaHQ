"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { Icon } from "@/components/portal/icons";
import { RENT_LAST, cedis, rentAtStop, rentRangeLabel, rentStopIndex } from "@/lib/exploreQuery";

/**
 * The rows Explore's Filters panel is made of: the phone's, drawn for a browser.
 *
 * The panel used to be a form. Rent was two labelled boxes, every property and
 * unit type was a chip — eleven for units — bedrooms and advance were more chips,
 * and the order was a fourth group, each under its own heading. It reached the
 * bottom of a laptop screen before anything was chosen. Each question is now one
 * row with its answer on the same line, as on the phone: a range for rent,
 * dropdowns for the lists, a segmented choice for bedrooms and a switch for
 * furnishing. Where the panel is wide enough the rows pair up two to a line.
 */

type Option = readonly [value: string, label: string];

/** The tallest a list grows before it scrolls. */
const LIST_MAX = 320;
/** Between a button and its list. */
const GAP = 6;
/** The least a list keeps from the window's edge. */
const EDGE = 12;

/**
 * Rent as one range: two thumbs on one track, from no minimum to no maximum.
 *
 * Two real range inputs over one drawn rail, so each thumb is announced, stepped
 * with the arrow keys and dragged natively. They snap to the phone's stops and
 * never cross, the readout says what the range means, and the search takes it
 * once the dragging settles. A rent from an older link that sits between stops
 * keeps its own figure in the readout until a thumb moves it.
 */
export function RentRange({
  minimum,
  maximum,
  onChange,
}: {
  /** Whole cedis, or empty for no limit. */
  minimum: string;
  maximum: string;
  onChange: (minimum: string, maximum: string) => void;
}) {
  const low = Math.min(rentStopIndex(minimum, 0), RENT_LAST - 1);
  const high = Math.max(rentStopIndex(maximum, RENT_LAST), low + 1);
  const span = { "--range-low": low / RENT_LAST, "--range-high": high / RENT_LAST } as CSSProperties;

  return (
    <div className="explore-range">
      <div className="explore-range-head">
        <span className="explore-filter-label">Rent per month</span>
        <span className="explore-range-readout">{rentRangeLabel(minimum, maximum)}</span>
      </div>
      <div className="explore-range-track" style={span}>
        <span className="explore-range-fill" aria-hidden="true" />
        <input
          type="range"
          className={`explore-range-input${low > RENT_LAST / 2 ? " is-front" : ""}`}
          min={0}
          max={RENT_LAST}
          step={1}
          value={low}
          aria-label="Minimum rent"
          aria-valuetext={minimum ? cedis(minimum) : "No minimum"}
          onChange={(event) => onChange(rentAtStop(Math.min(Number(event.target.value), high - 1), 0), maximum)}
        />
        <input
          type="range"
          className="explore-range-input"
          min={0}
          max={RENT_LAST}
          step={1}
          value={high}
          aria-label="Maximum rent"
          aria-valuetext={maximum ? cedis(maximum) : "No maximum"}
          onChange={(event) => onChange(minimum, rentAtStop(Math.max(Number(event.target.value), low + 1), RENT_LAST))}
        />
      </div>
    </div>
  );
}

/**
 * One answer from a list, as a dropdown the panel draws itself.
 *
 * A select-only combobox: the button names the question and shows the answer,
 * the list holds the choices with the current one ticked, and the keyboard walks
 * it the way it walks the operating system's. Escape puts the list away and
 * leaves the panel open. The list is fixed to the window rather than the panel,
 * which scrolls and would clip it, and opens below its button when it fits and
 * above when there is more room there. A set answer tints the button, so a panel
 * with filters on reads as set at a glance.
 */
export function FilterSelect({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<CSSProperties>({});
  const field = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const chosenIndex = Math.max(0, options.findIndex(([key]) => key === value));
  const labelId = `${name}-label`;
  const buttonId = `${name}-button`;
  const listId = `${name}-options`;
  const optionId = (at: number) => `${name}-option-${at}`;

  function show() {
    setActive(chosenIndex);
    setOpen(true);
  }

  function choose(at: number) {
    const option = options[at];
    setOpen(false);
    trigger.current?.focus();
    if (option && option[0] !== value) onChange(option[0]);
  }

  // Below the button when the list fits there, above it when there is more room.
  useLayoutEffect(() => {
    const button = trigger.current;
    if (!open || !button) return;
    const box = button.getBoundingClientRect();
    const viewport = document.documentElement;
    const below = viewport.clientHeight - box.bottom - GAP - EDGE;
    const above = box.top - GAP - EDGE;
    const wanted = Math.min(LIST_MAX, list.current?.scrollHeight ?? LIST_MAX);
    const downward = below >= wanted || below >= above;
    setPlace({
      right: Math.max(EDGE, viewport.clientWidth - box.right),
      maxHeight: Math.min(LIST_MAX, downward ? below : above),
      ...(downward ? { top: box.bottom + GAP } : { bottom: viewport.clientHeight - box.top + GAP }),
    });
  }, [open]);

  // The active option stays in view as the keys walk the list.
  useEffect(() => {
    const box = list.current;
    const option = box?.children[active] as HTMLElement | undefined;
    if (!open || !box || !option) return;
    if (option.offsetTop < box.scrollTop) box.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = option.offsetTop + option.offsetHeight - box.clientHeight;
    }
  }, [active, open]);

  // A press anywhere else, a scroll of anything but the list or a resize puts it away.
  useEffect(() => {
    if (!open) return;
    function pressed(event: PointerEvent) {
      if (!field.current?.contains(event.target as Node)) setOpen(false);
    }
    function scrolled(event: Event) {
      if (event.target !== list.current) setOpen(false);
    }
    function resized() {
      setOpen(false);
    }
    document.addEventListener("pointerdown", pressed);
    document.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", resized);
    return () => {
      document.removeEventListener("pointerdown", pressed);
      document.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", resized);
    };
  }, [open]);

  function walk(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const last = options.length - 1;
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        show();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((at) => Math.min(last, at + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((at) => Math.max(0, at - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(last);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={field} className={`explore-filter-cell explore-select${open ? " is-open" : ""}`}>
      <span id={labelId} className="explore-filter-label">{label}</span>
      <button
        ref={trigger}
        type="button"
        id={buttonId}
        role="combobox"
        className={`explore-select-button${chosenIndex > 0 ? " is-chosen" : ""}`}
        aria-labelledby={`${labelId} ${buttonId}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={(event) => {
          // A click from Enter or Space is the keys' to handle.
          if (event.detail === 0) return;
          if (open) setOpen(false);
          else show();
        }}
        onKeyDown={walk}
      >
        <span className="explore-select-value">{options[chosenIndex]?.[1]}</span>
        <Icon name="chevron-down" />
      </button>
      {open ? (
        <ul ref={list} id={listId} role="listbox" aria-labelledby={labelId} className="explore-select-list" style={place}>
          {options.map(([key, text], at) => (
            <li
              key={key || "any"}
              id={optionId(at)}
              role="option"
              aria-selected={at === chosenIndex}
              data-active={at === active}
              className="explore-select-option"
              onPointerEnter={() => setActive(at)}
              onClick={() => choose(at)}
            >
              <span>{text}</span>
              {at === chosenIndex ? <Icon name="check" /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * A few short answers side by side, as one segmented control.
 *
 * Real radios under one name, so the arrow keys move between them, drawn as
 * segments. Every segment keeps a one-pixel edge whether it is chosen or not, so
 * choosing moves nothing: the chosen one only changes colour.
 */
export function SegmentedChoice({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
}) {
  const labelId = `${name}-label`;
  return (
    <div className="explore-filter-cell">
      <span id={labelId} className="explore-filter-label">{label}</span>
      <div className="explore-segments" role="radiogroup" aria-labelledby={labelId}>
        {options.map(([key, text]) => (
          <label key={key || "any"} className="explore-segment">
            <input type="radio" name={name} value={key} checked={value === key} onChange={() => onChange(key)} className="control-input" />
            {text}
          </label>
        ))}
      </div>
    </div>
  );
}
