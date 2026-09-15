"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSession, type Me } from "@/lib/session";

import { Icon } from "./icons";

/**
 * Which Portfolio is being operated, and the way to change it.
 *
 * Switching Portfolio changes what every screen is about — the Properties, the
 * agreements, the requests and the money — so it is the header's navigation
 * context rather than a page title or account setting. Compact mode keeps only
 * the icon at constrained widths; desktop names the active Portfolio in place.
 *
 * Selecting one changes navigation and query scope only. Every endpoint behind
 * it re-checks the membership, and the shell remounts the page beneath so no
 * screen can show the Portfolio you just left while the next one loads.
 */

/** When the list is long enough that reading it beats scanning it. */
const SEARCHABLE_FROM = 7;

const TYPE_LABELS: Record<string, string> = {
  individual_owner: "Personal",
  property_company: "Property company",
  property_manager: "Property management",
  hostel_operator: "Hostel",
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  property_manager: "Manager",
  accountant: "Accountant",
  staff: "Staff",
};

type Portfolio = Me["contexts"][number];

/** Two letters of the name, which is enough to tell three Portfolios apart. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word[0] ?? "");
  return (letters.join("") || name.slice(0, 2)).toUpperCase();
}

function describe(portfolio: Portfolio): string {
  const type = TYPE_LABELS[portfolio.organization_type ?? ""] ?? portfolio.subtitle ?? "Portfolio";
  const role = ROLE_LABELS[portfolio.role ?? ""] ?? portfolio.role?.replaceAll("_", " ");
  return role ? `${type} · ${role}` : type;
}

export function PortfolioMenu({ me, context = false }: { me: Me; context?: boolean }) {
  const { activeContext, setActiveContext } = useSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setQuery("");
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Outside click and Escape. Pointerdown rather than click, so the menu closes
  // on the press instead of after whatever was underneath has reacted to it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  // Opening puts the caret where the person's next keystroke belongs: the
  // search box when there is one, otherwise the Portfolio they are in.
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const search = menu.querySelector<HTMLInputElement>("input[type='search']");
    if (search) {
      search.focus();
      return;
    }
    menu.querySelector<HTMLElement>("[data-active='true']")?.focus();
  }, [open]);

  const portfolios = useMemo(
    () => me.contexts.filter((context) => context.type === "organization"),
    [me.contexts],
  );
  const current = portfolios.find((context) => context.id === activeContext) ?? portfolios[0] ?? null;
  const searchable = portfolios.length >= SEARCHABLE_FROM;
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    if (!needle) return portfolios;
    return portfolios.filter((portfolio) =>
      `${portfolio.label} ${describe(portfolio)}`.toLocaleLowerCase("en-GH").includes(needle),
    );
  }, [portfolios, query]);

  /** Up and down move through the list; Home and End jump to its ends. */
  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[data-menu-item]") ?? []);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focus = (next: number) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus();
    };
    if (event.key === "ArrowDown") focus(index + 1);
    else if (event.key === "ArrowUp") focus(index - 1);
    else if (event.key === "Home") focus(0);
    else if (event.key === "End") focus(items.length - 1);
  }

  // Nothing to be in, nothing to switch: a tenant has no Portfolio, and neither
  // has a provider before their first one.
  if (me.capabilities.active_workspace !== "provider" || !current) return null;

  const several = portfolios.length > 1;

  return (
    <div className="portal-header-portfolio" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={context ? "portal-context-switcher" : "portal-header-icon"}
        aria-haspopup="menu"
        aria-expanded={open}
        // The tooltip is the short version; the accessible name carries where
        // you actually are, which is the question the icon answers.
        title="Switch portfolio"
        aria-label={`Portfolio: ${current.label}. Switch portfolio`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="portal-context-icon"><Icon name="portfolio" /></span>
        {context ? (
          <span className="portal-context-copy">
            <span>Portfolio</span>
            <strong>{current.label}</strong>
          </span>
        ) : null}
        {context ? <Icon name="chevron-down" /> : null}
        {several ? <span className="portal-header-dot" aria-hidden="true" /> : null}
      </button>

      {open ? (
        <div
          ref={menuRef}
          className="portfolio-menu"
          role="menu"
          aria-label="Your Portfolios"
          onKeyDown={onMenuKeyDown}
        >
          <p className="portfolio-menu-title">Your Portfolios</p>

          {searchable ? (
            <label className="portfolio-menu-search">
              <span className="sr-only">Search your Portfolios</span>
              <input
                type="search"
                value={query}
                placeholder="Search Portfolios"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          ) : null}

          <div className="portfolio-menu-list">
            {visible.map((portfolio) => {
              const isCurrent = portfolio.id === current.id;
              return (
                <button
                  key={portfolio.id}
                  type="button"
                  className="portfolio-row"
                  role="menuitemradio"
                  aria-checked={isCurrent}
                  data-active={isCurrent}
                  data-menu-item
                  onClick={() => {
                    if (!isCurrent) setActiveContext(portfolio.id);
                    // Focus goes back to the icon it came from: the header does
                    // not remount, and a keyboard left on a closed menu has
                    // nowhere to be.
                    close();
                  }}
                >
                  <span className="portfolio-row-mark" aria-hidden="true">
                    {initials(portfolio.label)}
                  </span>
                  <span className="portfolio-row-text">
                    <span className="portfolio-row-name">{portfolio.label}</span>
                    <span className="portfolio-row-meta">{describe(portfolio)}</span>
                  </span>
                  {isCurrent ? (
                    <svg
                      className="portfolio-row-check"
                      viewBox="0 0 20 20" width="16" height="16" fill="none"
                      stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m4 10.5 4 4 8-9" />
                    </svg>
                  ) : null}
                </button>
              );
            })}
            {visible.length === 0 ? (
              <p className="portfolio-menu-empty">No Portfolio matches that.</p>
            ) : null}
          </div>

          {/* Settling a Portfolio's affairs is not switching between them, so it
              sits below the line rather than in the list you are scanning.

              There is nothing to create here. An account is given its one
              Portfolio when its provider access is approved, and every other
              Portfolio in this list arrived as somebody's invitation. */}
          <div className="portfolio-menu-foot">
            <Link
              href={"/settings/team" as never}
              className="portfolio-menu-action"
              role="menuitem"
              data-menu-item
              onClick={() => close(false)}
            >
              Portfolio settings
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
