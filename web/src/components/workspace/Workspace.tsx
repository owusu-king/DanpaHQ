"use client";

import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/portal/icons";

/**
 * The parts every operational list page is built from, so moving between them
 * feels like one workspace rather than a set of screens: the same centred
 * column, the same title with its mark, the same segmented scope control and
 * the same quiet panel holding the records and every state they can be in.
 * Styles live in `workspace.css`.
 */

export function WorkspaceHead({
  icon,
  title,
  summary,
  mark,
  actions,
  path,
}: {
  icon: IconName;
  /** Replaces the icon tile, e.g. a person's initials on their record. */
  mark?: ReactNode;
  title: string;
  /** One live line under the title: counts, money, or nothing while loading. */
  summary?: ReactNode;
  actions?: ReactNode;
  /** A breadcrumb above the title when this page is a level deeper. */
  path?: ReactNode;
}) {
  return (
    <header className="ws-head">
      {path ? <div className="ws-head-path">{path}</div> : null}
      <div className="ws-head-row">
        <div className="ws-title">
          {mark ?? <span className="ws-title-mark" aria-hidden="true"><Icon name={icon} /></span>}
          <div className="ws-title-text">
            <h1>{title}</h1>
            <p className="ws-summary" aria-live="polite">{summary ?? <span aria-hidden="true">&nbsp;</span>}</p>
          </div>
        </div>
        {actions ? <div className="ws-head-actions">{actions}</div> : null}
      </div>
    </header>
  );
}

export type SegmentOption<T extends string> = { key: T; label: string; count?: number };

/**
 * A compact segmented control whose thumb is measured, not guessed, so it
 * follows the labels' real widths and slides between them instead of jumping.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  inline = false,
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Smaller, and sitting in a toolbar rather than centred under the head. */
  inline?: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const counts = options.map((option) => option.count ?? "").join("|");

  useLayoutEffect(() => {
    const measure = () => {
      const selected = rail.current?.querySelector<HTMLElement>(`[data-segment="${value}"]`);
      if (selected) setThumb({ x: selected.offsetLeft, w: selected.offsetWidth });
    };
    measure();
    // Labels reflow with the viewport and the counts' breakpoint; the thumb follows.
    const observer = new ResizeObserver(measure);
    if (rail.current) observer.observe(rail.current);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [value, disabled, counts]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = options.findIndex((option) => option.key === value);
    const step = event.key === "ArrowRight" ? 1 : options.length - 1;
    const next = options[(index + step) % options.length]?.key;
    if (!next) return;
    onChange(next);
    rail.current?.querySelector<HTMLElement>(`[data-segment="${next}"]`)?.focus();
  }

  return (
    <div className={`ws-segment-row${inline ? " is-inline" : ""}`}>
      <div
        className="ws-segments"
        role="tablist"
        aria-label={label}
        ref={rail}
        onKeyDown={onKeyDown}
        data-disabled={disabled || undefined}
      >
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            data-segment={option.key}
            className="ws-segment"
            aria-selected={value === option.key}
            tabIndex={value === option.key ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.key)}
          >
            {option.label}
            {disabled || option.count === undefined ? null : (
              <span className="ws-segment-count" data-empty={option.count === 0 || undefined}>{option.count}</span>
            )}
          </button>
        ))}
        <span
          className="ws-segment-thumb"
          aria-hidden="true"
          style={thumb ? { transform: `translateX(${thumb.x}px)`, width: thumb.w } : { opacity: 0 }}
        />
      </div>
    </div>
  );
}

/**
 * A centred message inside a panel: first-time empty, no matches, or a failure.
 *
 * The mark is the page's own glyph drawn large and light, with no disc behind
 * it — and, for an absence, struck through, so "no notifications" is a bell
 * with a line across it rather than a bell in a badge. A tick ("all done") and
 * a warning are never struck: they say something is there.
 */
export function PanelState({
  tone = "calm",
  icon,
  title,
  body,
  action,
  crossed = tone === "calm" && icon !== "check" && icon !== "warning",
}: {
  tone?: "calm" | "error";
  icon: IconName;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  /** Strike the glyph through: there is none of this here. */
  crossed?: boolean;
}) {
  return (
    <div className={`ws-state${tone === "error" ? " is-error" : ""}`} role={tone === "error" ? "alert" : undefined}>
      <span className={`ws-state-mark${crossed ? " is-crossed" : ""}${icon === "check" ? " is-done" : ""}`} aria-hidden="true">
        <Icon name={icon} />
        {crossed ? (
          <svg className="ws-state-strike" viewBox="0 0 20 20" focusable="false">
            <path className="ws-state-strike-gap" d="M3.5 3.5 16.5 16.5" />
            <path className="ws-state-strike-line" d="M3.5 3.5 16.5 16.5" />
          </svg>
        ) : null}
      </span>
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  );
}

/** Loading that keeps the shape of a row, so nothing jumps when the records land. */
export function PanelSkeleton({ rows = 5, round = false }: { rows?: number; round?: boolean }) {
  return (
    <div className="ws-skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="ws-skeleton-row" key={index} style={{ "--ws-order": index } as React.CSSProperties}>
          <span className={`ws-skeleton-block is-mark${round ? " is-round" : ""}`} />
          <span className="ws-skeleton-lines">
            <span className="ws-skeleton-block" style={{ width: `${46 - index * 4}%` }} />
            <span className="ws-skeleton-block is-thin" style={{ width: `${72 - index * 5}%` }} />
          </span>
          <span className="ws-skeleton-block is-end" />
        </div>
      ))}
    </div>
  );
}

/** A compact search field for a panel head, with a clear button once there is a query. */
export function PanelSearch({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="ws-search">
      <svg className="ws-search-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        <circle cx="9" cy="9" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="m13 13 3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        ref={input}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
      />
      {value ? (
        <button
          type="button"
          className="ws-search-clear"
          aria-label="Clear search"
          onClick={() => { onChange(""); input.current?.focus(); }}
        >
          <Icon name="close" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The one thing waiting on the reader, lifted above the list: an agreement to
 * review, an application's agreement arriving. The row it stands for stays in
 * the list — this is the way in, not a second copy of the record. Styles in
 * workspace.css (`.ws-next`).
 */
export function NextUp({
  tone,
  eyebrow,
  title,
  detail,
  hint,
  photoUrl,
  icon,
  more,
  onOpen,
  action,
}: {
  /** Overdue reads in laterite; everything else waits in kola. */
  tone?: "overdue";
  /** Where it stands, in the meaning module's words. */
  eyebrow: string;
  title: string;
  /** Muted after the title: the Unit and place. */
  detail?: string;
  hint: string;
  photoUrl?: string | null;
  icon: IconName;
  /** Others like it, and how to see them all. */
  more?: { count: number; onShow: () => void };
  /** Opens the record itself. */
  onOpen: () => void;
  action: { label: string; href?: string; onClick?: () => void };
}) {
  const arrow = (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M3.5 8h9m-4-4.5L13 8l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return (
    <section className="ws-next" data-tone={tone} aria-label="Needs you">
      <span className="ws-next-photo" aria-hidden="true">
        {/* Short-lived signed URLs from the files service. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photoUrl ? <img src={photoUrl} alt="" /> : <Icon name={icon} />}
      </span>
      <span className="ws-next-copy">
        <small>{eyebrow}</small>
        <button type="button" onClick={onOpen} aria-haspopup="dialog">
          {title}{detail ? <span> · {detail}</span> : null}
        </button>
        {more && more.count > 0 ? (
          <button type="button" className="ws-next-more" onClick={more.onShow}>
            and {more.count} more waiting for you
          </button>
        ) : (
          <span className="ws-next-hint">{hint}</span>
        )}
      </span>
      {action.href ? (
        <Link href={action.href as never} className="ws-next-action">{action.label}{arrow}</Link>
      ) : (
        <button type="button" className="ws-next-action" onClick={action.onClick} aria-haspopup="dialog">{action.label}{arrow}</button>
      )}
    </section>
  );
}

export type FilterOption<T extends string> = { value: T; label: string; count?: number; disabled?: boolean };

/**
 * One quiet menu for a secondary filter or an order, so a panel head never
 * grows a row of native selects. The trigger turns kola while it narrows the
 * list, so a filter that is on can be seen without opening it.
 */
export function FilterMenu<T extends string>({
  label,
  icon = "filters",
  value,
  options,
  onChange,
  active,
  prefix,
}: {
  /** What the menu chooses, for assistive technology. */
  label: string;
  icon?: IconName;
  value: T;
  options: FilterOption<T>[];
  onChange: (value: T) => void;
  /** Whether the current choice narrows the list (drawn in kola). */
  active?: boolean;
  /** Shown before the chosen label, e.g. "Sort". */
  prefix?: string;
}) {
  const chosen = options.find((option) => option.value === value);
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className="ws-filter" data-active={active ? "" : undefined} aria-label={`${label}: ${chosen?.label ?? ""}`}>
        <Icon name={icon} />
        <span>{prefix ? <em className="ws-filter-prefix">{prefix}</em> : null}{chosen?.label}</span>
        <Icon name="chevron-down" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="ws-menu" align="start" sideOffset={6}>
          <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
            {options.map((option) => (
              <DropdownMenu.RadioItem key={option.value} className="ws-menu-item" value={option.value} disabled={option.disabled}>
                <span>{option.label}</span>
                {option.count === undefined ? <span /> : <span className="ws-menu-count">{option.count}</span>}
                <DropdownMenu.ItemIndicator className="ws-menu-check"><Icon name="check" /></DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Arrow keys across a grid of cards, the way the eye moves: left and right
 * along a row, up and down to the nearest card in the row above or below.
 * Returns a keydown handler for the element that contains the cards.
 */
export function gridKeyNavigation(cardSelector: string) {
  return (event: React.KeyboardEvent<HTMLElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const target = event.target as HTMLElement;
    if (!target.matches(cardSelector)) return;
    const cards = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(cardSelector));
    const index = cards.indexOf(target);
    let next = index;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = cards.length - 1;
    else if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (event.key === "ArrowRight") next = Math.min(cards.length - 1, index + 1);
    else {
      const here = target.getBoundingClientRect();
      const down = event.key === "ArrowDown";
      let best = Number.POSITIVE_INFINITY;
      cards.forEach((card, position) => {
        const box = card.getBoundingClientRect();
        const dy = down ? box.top - here.top : here.top - box.top;
        if (dy <= 1) return;
        const score = dy * 1000 + Math.abs(box.left - here.left);
        if (score < best) { best = score; next = position; }
      });
    }
    event.preventDefault();
    cards[next]?.focus();
  };
}
