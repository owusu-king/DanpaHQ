"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Icon, type IconName } from "@/components/portal/icons";
import { ManagementFailure, managementFetch } from "@/lib/management";

/* The Management console's kit.
 *
 * One page header, one status vocabulary, one table, one side drawer for
 * decisions, one filter row and one way to confirm that something saved. The
 * pages arrange these for their own task; none of them restyle them. */

type Location = { section: string; page: string } | null;

/** The shell says where a page sits, so headers name their section without each page restating it. */
export const LocationContext = createContext<Location>(null);

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Only for a page the sidebar does not name; otherwise the section comes from the sidebar. */
  eyebrow?: string;
}) {
  const location = useContext(LocationContext);
  const section = eyebrow ?? location?.section;
  return (
    <header className="management-page-header">
      <div className="management-page-heading">
        {section ? <span className="management-eyebrow">{section}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="management-header-actions">{actions}</div> : null}
    </header>
  );
}

type Tone = "positive" | "negative" | "warning" | "info" | "neutral";

const TONES: Record<Exclude<Tone, "neutral">, string[]> = {
  positive: ["active", "accepted", "approved", "resolved", "verified", "completed", "complete", "settled", "true"],
  negative: ["rejected", "suspended", "dismissed", "inactive", "declined", "failed", "false"],
  warning: ["pending_review", "pending", "open", "flagged", "urgent", "high", "unverified", "missing"],
  info: ["in_review", "investigating", "needs_more_info", "processing"],
};

function toneOf(value: string): Tone {
  for (const [tone, values] of Object.entries(TONES)) {
    if (values.includes(value)) return tone as Tone;
  }
  return "neutral";
}

/** "pending_review" → "Pending review". */
export function humanize(value: string) {
  const words = value.replaceAll("_", " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : words;
}

export function Status({
  value,
  label,
  tone,
}: {
  value: string | boolean | null | undefined;
  /** Words to show instead of the raw value, when the value alone would be ambiguous. */
  label?: string;
  tone?: Tone;
}) {
  const raw = typeof value === "boolean" ? String(value) : (value || "");
  const text = label ?? (typeof value === "boolean" ? (value ? "Active" : "Inactive") : humanize(raw) || "Unknown");
  return <span className={`management-status ${tone ?? toneOf(raw)}`}>{text}</span>;
}

export function Panel({
  children,
  title,
  meta,
  actions,
  id,
  busy,
}: {
  children: React.ReactNode;
  title?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  id?: string;
  /** The records are being refreshed: they stay, dimmed, until the new ones land. */
  busy?: boolean;
}) {
  return (
    <section className="management-panel" id={id} aria-label={title} aria-busy={busy || undefined}>
      {title ? (
        <div className="management-panel-title">
          <div><h2>{title}</h2>{meta ? <span>{meta}</span> : null}</div>
          {actions ? <div className="management-panel-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Search and filters for the records below them, in one row. */
export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="management-toolbar">{children}</div>;
}

export function SearchField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="management-search">
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        <circle cx="9" cy="9" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="m13 13 3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
      <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder ?? label} />
    </label>
  );
}

export function FilterTabs<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; count?: number }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="management-tabs" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value || "all"}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          <span className="management-tab-label" data-label={option.label}>{option.label}</span>
          {option.count !== undefined ? <span className="management-tab-count">{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * A records table. On a phone each row becomes a short stack of labelled
 * values; the labels are copied from the header, so a page writes its table once.
 *
 * Column widths are taken from the first records the table shows and then held
 * as proportions. Left to the browser, every filter and every search keystroke
 * would re-divide the width by whatever rows remained, and the columns would
 * jump under the reader's eye.
 */
export function DataTable({ children, label }: { children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLTableElement>(null);
  const heldFor = useRef("");
  useLayoutEffect(() => {
    const table = ref.current;
    if (!table) return;
    const headCells = Array.from(table.querySelectorAll<HTMLElement>("thead th"));
    const shape = `${label}:${headCells.length}`;
    const stacked = (table.parentElement?.clientWidth ?? window.innerWidth) <= 768;
    if (heldFor.current !== shape && !stacked && table.tBodies[0]?.rows.length) {
      table.style.tableLayout = "auto";
      headCells.forEach((cell) => { cell.style.width = ""; });
      const total = table.getBoundingClientRect().width;
      const widths = headCells.map((cell) => (cell.getBoundingClientRect().width / total) * 100);
      headCells.forEach((cell, index) => { cell.style.width = `${Math.round(widths[index]! * 1000) / 1000}%`; });
      table.style.tableLayout = "fixed";
      heldFor.current = shape;
    }
    const heads = Array.from(table.querySelectorAll("thead th"), (cell) => cell.textContent?.trim() ?? "");
    table.querySelectorAll("tbody tr").forEach((row) => {
      let column = 0;
      Array.from(row.children).forEach((cell) => {
        const span = Number(cell.getAttribute("colspan") || 1);
        if (span === 1 && heads[column]) cell.setAttribute("data-label", heads[column]!);
        column += span;
      });
    });
  });
  return <div className="management-table-wrap"><table ref={ref} aria-label={label}>{children}</table></div>;
}

/** An absence, drawn as the subject's own glyph struck through. */
export function Empty({ message, icon = "archive", title }: { message?: string; icon?: IconName; title?: string }) {
  return (
    <div className="management-empty">
      <span className="management-empty-mark" aria-hidden="true">
        <Icon name={icon} />
        <svg viewBox="0 0 20 20" focusable="false">
          <path className="is-gap" d="M3.5 3.5 16.5 16.5" />
          <path d="M3.5 3.5 16.5 16.5" />
        </svg>
      </span>
      {title ? <strong>{title}</strong> : null}
      {message ? <p>{message}</p> : null}
    </div>
  );
}

export function Feedback({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <div role={error ? "alert" : "status"} className={`management-feedback ${error ? "error" : "success"}`}>
      <Icon name={error ? "warning" : "check"} />
      <span>{error || success}</span>
    </div>
  );
}

/**
 * One API resource. `loading` is the first load only; later loads (a new
 * filter, a reload after a decision) set `refreshing` and keep the rows on
 * screen, so a list never blanks out under the person working it.
 */
export function useResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setPending(true);
    setError("");
    try {
      setData(await managementFetch<T>(path));
    } catch (cause) {
      setError(cause instanceof ManagementFailure ? cause.message : "Could not load this workspace.");
    } finally {
      setPending(false);
    }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, loading: pending && data === null, refreshing: pending && data !== null, error, reload: load };
}

/** Loading keeps the shape of the rows that are coming; a failure offers the retry. */
export function ResourceState({
  loading,
  error,
  onRetry,
  rows = 4,
}: {
  loading: boolean;
  error: string;
  onRetry?: () => void;
  rows?: number;
}) {
  if (loading) {
    return (
      <div className="management-skeleton" aria-busy="true" role="status">
        <span className="sr-only">Loading</span>
        {Array.from({ length: rows }).map((_, index) => (
          <span key={index} style={{ width: `${88 - index * 9}%` }} />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="management-feedback error">
        <Icon name="warning" />
        <span>{error}</span>
        {onRetry ? <button type="button" className="management-link-button" onClick={onRetry}>Try again</button> : null}
      </div>
    );
  }
  return null;
}

export function Facts({ children, columns = 2 }: { children: React.ReactNode; columns?: 1 | 2 | 3 }) {
  return <dl className={`management-facts is-${columns}`}>{children}</dl>;
}

export function Fact({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return <div><dt>{label}</dt><dd className={mono ? "management-mono" : undefined}>{children}</dd></div>;
}

/**
 * The side drawer every record opens in.
 *
 * The list stays where it was behind it, so a reviewer never loses their place
 * in a queue. It is a native modal dialog: focus moves in and is held there,
 * Escape and the dimmed page close it, and focus returns to the row's button.
 * While a decision is saving it cannot be dismissed half-way.
 */
export function Drawer({
  title,
  meta,
  eyebrow,
  onClose,
  children,
  footer,
  busy = false,
  wide = false,
}: {
  title: string;
  meta?: React.ReactNode;
  eyebrow?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  busy?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const titleId = useId();
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const dismiss = () => { if (!busyRef.current) closeRef.current(); };

  return (
    <dialog
      ref={ref}
      className={`management-drawer${wide ? " is-wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); dismiss(); }}
      onPointerDown={(event) => { pressedBackdrop.current = event.target === event.currentTarget; }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedBackdrop.current) dismiss();
        pressedBackdrop.current = false;
      }}
    >
      <div className="management-drawer-frame">
        <header className="management-drawer-header">
          <div>
            {eyebrow ? <span className="management-eyebrow">{eyebrow}</span> : null}
            <h2 id={titleId}>{title}</h2>
            {meta ? <p>{meta}</p> : null}
          </div>
          <button type="button" className="management-icon-button" onClick={dismiss} aria-label="Close" disabled={busy}>
            <Icon name="close" />
          </button>
        </header>
        <div className="management-drawer-body">{children}</div>
        {footer ? <footer className="management-drawer-footer">{footer}</footer> : null}
      </div>
    </dialog>
  );
}

/** A titled part of a drawer or form. */
export function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="management-section">
      <div className="management-section-title"><h3>{title}</h3>{aside}</div>
      {children}
    </section>
  );
}

type Notice = { id: number; tone: "success" | "error"; text: string };
const NoticeContext = createContext<(tone: Notice["tone"], text: string) => void>(() => {});

/**
 * One quiet confirmation at the foot of the screen.
 *
 * Decisions are made in a drawer that closes when they save; a message at the
 * top of a long queue would be out of sight. A confirmation leaves on its own;
 * a failure stays until it is dismissed.
 */
export function NoticeProvider({ children }: { children: React.ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const counter = useRef(0);
  const notify = useCallback((tone: Notice["tone"], text: string) => {
    counter.current += 1;
    setNotice({ id: counter.current, tone, text });
  }, []);

  useEffect(() => {
    if (!notice || notice.tone === "error") return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <NoticeContext.Provider value={notify}>
      {children}
      <div className="management-notice-region" aria-live="polite">
        {notice ? (
          <div key={notice.id} className={`management-notice is-${notice.tone}`} role={notice.tone === "error" ? "alert" : undefined}>
            <Icon name={notice.tone === "error" ? "warning" : "check"} />
            <span>{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
              <Icon name="close" />
            </button>
          </div>
        ) : null}
      </div>
    </NoticeContext.Provider>
  );
}

export function useNotice() {
  return useContext(NoticeContext);
}

/**
 * A filter or search kept in the address, so a refresh, a shared link or Back
 * returns to the same view. Writes replace the entry rather than adding one.
 */
export function useQueryState(key: string, fallback = ""): [string, (value: string) => void] {
  // Console pages only render in the browser, after the session check, so the
  // address can be read on the first render: no default view flashes first.
  const [value, setValue] = useState(() => (
    typeof window === "undefined" ? fallback : new URLSearchParams(window.location.search).get(key) ?? fallback
  ));
  const update = useCallback((next: string) => {
    setValue(next);
    const params = new URLSearchParams(window.location.search);
    if (next && next !== fallback) params.set(key, next);
    else params.delete(key);
    const query = params.toString();
    // `null`, never a copy of the current state: Next ignores writes that carry its own keys.
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, [fallback, key]);
  return [value, update];
}

export function useDebounced<T>(value: T, delay = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return settled;
}

/** Does any of these values contain the query? Case and accents are ignored. */
export function matches(query: string, ...values: Array<string | null | undefined>) {
  const needle = fold(query.trim());
  if (!needle) return true;
  return values.some((value) => value && fold(value).includes(needle));
}

function fold(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** "3 of 40 shown", or "40" when nothing is filtered out. */
export function countMeta(shown: number, total: number, noun: [string, string]) {
  const word = total === 1 ? noun[0] : noun[1];
  return shown === total ? `${total} ${word}` : `${shown} of ${total} ${word}`;
}

/** A calendar date ("2026-11-01") without a time, read as the day it names. */
export function formatDay(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}

export function managementError(cause: unknown, fallback: string) {
  return cause instanceof ManagementFailure ? cause.message : fallback;
}

/**
 * Views of one page that replace each other in place: the bar names them, and
 * only the chosen one is shown. Arrow keys, Home and End move between them, as
 * in any tab set. Pair each with a `TabPanel` of the same id.
 */
export function Tabs({
  label,
  tabs,
  active,
  onChange,
}: {
  label: string;
  tabs: ReadonlyArray<{ id: string; label: string; marked?: boolean }>;
  active: string;
  onChange: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  function move(event: React.KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
        : event.key === "Home" ? 0
          : event.key === "End" ? last
            : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(tabs[next]!.id);
    ref.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  }
  return (
    <div className="management-tabbar" role="tablist" aria-label={label} ref={ref}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={tab.id === active}
          aria-controls={`tabpanel-${tab.id}`}
          tabIndex={tab.id === active ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => move(event, index)}
        >
          {tab.label}
          {tab.marked ? <span className="management-tab-mark" aria-label="unsaved changes" /> : null}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ id, active, children }: { id: string; active: string; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={`tabpanel-${id}`} aria-labelledby={`tab-${id}`} hidden={id !== active} className="management-tabpanel">
      {children}
    </div>
  );
}
