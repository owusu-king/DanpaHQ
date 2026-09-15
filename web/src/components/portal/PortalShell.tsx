"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { listNotifications } from "@/lib/console";
import { useSession, type Me } from "@/lib/session";
import { activeHref, portalSections, type PortalSection } from "@/lib/portalNav";

import { AccountMenu } from "./AccountMenu";
import { PortalGate } from "./PortalGate";
import { PortfolioMenu } from "./PortfolioMenu";
import { PortalSearch } from "./PortalSearch";
import { Icon } from "./icons";

/**
 * The authenticated application shell.
 *
 * One shell for both roles. The role decides what is *in* the navigation, never
 * whether there is navigation — which is the difference between a product with
 * two audiences and two products sharing a domain name.
 *
 * Three widths, and they are genuinely different rather than one design
 * squeezed:
 *
 * - **≥1024px** a permanent rail, which the person may collapse to icons.
 * - **768–1024px** the same rail, collapsed by default, because at that width
 *   the labels cost more than they give.
 * - **<768px** no rail at all. A 68px vertical strip on a 360px phone is a
 *   sixth of the screen spent on chrome, so navigation becomes a drawer.
 */

const COLLAPSE_KEY = "portal.sidebar";

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { state, activeContext } = useSession();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  // `null` until the stored preference is read. Rendering expanded and then
  // snapping to collapsed would animate a jump on every load, so the shell
  // holds still until it knows, and the transition is enabled after.
  const [collapsed, setCollapsed] = useState<boolean | null>(null);

  useEffect(() => {
    // Read in an effect rather than in the initial state: the server has no
    // localStorage, so seeding from it directly is a hydration mismatch.
    const stored = window.localStorage.getItem(COLLAPSE_KEY);
    if (stored === "collapsed" || stored === "expanded") {
      setCollapsed(stored === "collapsed");
      return;
    }
    // No preference yet. Tablet-width windows start collapsed; a wide desktop
    // starts expanded. Either way the person's own choice wins from then on.
    setCollapsed(window.matchMedia("(max-width: 80rem)").matches);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      window.localStorage.setItem(COLLAPSE_KEY, next ? "collapsed" : "expanded");
      return next;
    });
  }, []);

  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const drawer = document.querySelector<HTMLElement>("#portal-drawer");
      const focusable = drawer
        ? Array.from(drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        : [];
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus follows the drawer in and comes back out with it. Without this a
    // keyboard user opens the navigation and is still tabbing through the page
    // underneath, which is the same as the drawer not having opened.
    const opener = document.activeElement as HTMLElement | null;
    document.querySelector<HTMLElement>("#portal-drawer a")?.focus();

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      opener?.focus();
    };
  }, [drawerOpen]);

  // Polled rather than pushed: there is no socket here, and someone opening the
  // portal wants the count to be right now, not eventually.
  useEffect(() => {
    if (state.status !== "signed_in") return;
    let cancelled = false;
    const read = () =>
      listNotifications()
        .then((page) => !cancelled && setUnread(page.unread_count))
        .catch(() => undefined);
    void read();
    const timer = setInterval(read, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [state.status]);

  if (state.status !== "signed_in") {
    // Never the page itself: every portal page needs an account to render, and
    // handing them one without it is what produced the blank screen. The gate
    // says which of the three situations this is and offers the way out of it.
    return (
      <main id="main" className="portal-main">
        <PortalGate />
      </main>
    );
  }

  const me = state.me;
  // The rail names the Portfolio being operated, so "what am I managing" is
  // answered on every screen rather than only inside the account menu — and the
  // same context decides which sections belong to the role holding it.
  const portfolio = me.contexts.find(
    (context) => context.type === "organization" && context.id === activeContext,
  ) ?? me.contexts.find((context) => context.type === "organization") ?? null;
  const portfolioName = portfolio?.label
    ?? me.contexts.find((context) => context.id === activeContext)?.label
    ?? null;
  const sections = portalSections(me, portfolioName, portfolio?.access ?? null);
  const current = activeHref(sections, pathname);
  const currentLabel = sections
    .flatMap((section) => section.items)
    .find((item) => item.href === current)?.label ?? "Portal";
  const isProviderSpace = me.capabilities.active_workspace === "provider"
    && me.capabilities.provider.workspace_access;

  const isCollapsed = collapsed === true;

  return (
    <div
      className={`portal${isCollapsed ? " is-collapsed" : ""}`}
      // Suppresses the width transition until the stored preference is known,
      // so the first paint settles instead of sliding.
      data-ready={collapsed === null ? undefined : "true"}
    >
      <aside className="portal-rail">
        <div className="portal-rail-head">
          <PortalBrand me={me} collapsed={isCollapsed} />
          <button
            type="button"
            className="portal-collapse"
            onClick={toggleCollapsed}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={isCollapsed}
          >
            <Icon name="panel" />
          </button>
        </div>

        <PortalNav
          sections={sections}
          current={current}
          unread={unread}
          collapsed={isCollapsed}
        />

        <div className="portal-rail-foot">
          <AccountMenu me={me} collapsed={isCollapsed} />
        </div>
      </aside>

      <div
        className={`portal-workspace${pathname === "/home" ? " is-dashboard" : ""}`}
        inert={drawerOpen ? true : undefined}
        aria-hidden={drawerOpen || undefined}
      >
        {/* Provider chrome carries workspace context rather than repeating the
            page heading. Equal outer zones keep search centred while account
            actions stay in a predictable place on every provider screen. */}
        <header className={`portal-header${isProviderSpace ? " is-provider" : ""}`}>
          <div className="portal-header-context">
            <button
              type="button"
              className="portal-menu-button"
              aria-expanded={drawerOpen}
              aria-controls="portal-drawer"
              onClick={() => setDrawerOpen(true)}
            >
              <span aria-hidden="true" style={{ display: "grid", gap: 4, width: 18 }}>
                <span style={RULE} /><span style={RULE} /><span style={RULE} />
              </span>
              <span className="sr-only">Open navigation</span>
            </button>
            {isProviderSpace ? <PortfolioMenu me={me} context /> : (
              <span className="portal-header-title">{currentLabel}</span>
            )}
          </div>

          {isProviderSpace ? (
            <PortalSearch
              organizationId={
                activeContext?.startsWith("organization:")
                  ? activeContext.slice("organization:".length)
                  : null
              }
            />
          ) : null}

          <div className="portal-header-actions">
            <Link href="/updates" className="portal-header-updates">
              <Icon name="updates" />
              <span className="sr-only">
                {unread > 0 ? `Updates, ${unread} unread` : "Updates"}
              </span>
              {unread > 0 ? (
                <span className="portal-count" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>
              ) : null}
            </Link>

          </div>
        </header>

        {/*
          Keyed by the Portfolio: switching remounts everything below, so a
          screen cannot show the Portfolio somebody has just left while the next
          one loads. Page state is about that Portfolio, and it goes with it.
        */}
        <main id="main" className="portal-main" key={activeContext ?? "no-context"}>
          {state.stale ? (
            <p className="portal-stale" role="status">
              Showing your last confirmed details — we could not reach the service just now.
            </p>
          ) : null}
          {children}
        </main>
      </div>

      {drawerOpen ? (
        <>
          <button
            type="button"
            className="portal-scrim"
            aria-label="Close navigation"
            tabIndex={-1}
            onClick={() => setDrawerOpen(false)}
          />
          <div id="portal-drawer" className="portal-drawer" role="dialog" aria-modal="true" aria-label="Navigation">
            <PortalBrand me={me} collapsed={false} />
            <PortalNav
              sections={sections}
              current={current}
              unread={unread}
              collapsed={false}
              withHints
            />
            {!isProviderSpace ? (
              <div className="portal-rail-foot">
                <AccountMenu me={me} collapsed={false} />
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

const RULE: React.CSSProperties = { height: 2, borderRadius: 1, background: "currentColor" };

function PortalBrand({ me, collapsed }: { me: Me; collapsed: boolean }) {
  return (
    <Link href="/home" className="portal-brand" aria-label="Ghana Rental — home">
      <span className="portal-brand-mark" aria-hidden="true">GR</span>
      <span className="portal-brand-text">
        <strong>Ghana Rental</strong>
        <span>{workspaceLabel(me)}</span>
      </span>
      {collapsed ? <span className="sr-only">Ghana Rental — home</span> : null}
    </Link>
  );
}

function workspaceLabel(me: Me): string {
  if (me.capabilities.active_workspace === "provider") {
    return me.capabilities.provider.workspace_access ? "Provider" : "Provider · in review";
  }
  return "Renting";
}

function PortalNav({
  sections,
  current,
  unread,
  collapsed,
  withHints = false,
}: {
  sections: PortalSection[];
  current: string | null;
  unread: number;
  collapsed: boolean;
  withHints?: boolean;
}) {
  return (
    <nav className="portal-nav" aria-label="Portal">
      {sections.map((section, index) => (
        <div className="portal-nav-section" key={section.title ?? `section-${index}`}>
          {/* The heading is hidden from sight when collapsed but kept for
              assistive technology, so the grouping survives the narrowing. */}
          {section.title ? (
            <p className={`portal-nav-title${collapsed ? " sr-only" : ""}`}>{section.title}</p>
          ) : null}
          {section.items.map((item) => (
            <Link
              key={item.href}
              href={item.href as never}
              className="portal-nav-link"
              aria-current={current === item.href ? "page" : undefined}
              title={collapsed ? item.label : undefined}
            >
              <Icon name={item.icon} />
              {/*
                The label stays in the DOM at every width. Collapsed it is
                visually hidden rather than removed, so the link keeps its
                accessible name without depending on the tooltip — which is
                decoration, and `aria-hidden` for that reason.
              */}
              <span className={`portal-nav-label${collapsed ? " sr-only" : ""}`}>
                {item.label}
                {withHints && item.hint ? (
                  <span className="portal-nav-hint">{item.hint}</span>
                ) : null}
              </span>
              {item.href === "/updates" && unread > 0 ? (
                <span
                  className={collapsed ? "portal-dot" : "portal-count"}
                  aria-label={`${unread} unread`}
                >
                  {collapsed ? "" : unread}
                </span>
              ) : null}
              {collapsed ? (
                <span className="portal-tip" aria-hidden="true">{item.label}</span>
              ) : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
