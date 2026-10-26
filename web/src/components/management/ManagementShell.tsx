"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { useManagement } from "@/lib/management";
import { Icon, type IconName } from "@/components/portal/icons";
import { ManagementAccountMenu } from "./ManagementAccountMenu";
import { LocationContext, NoticeProvider } from "./ManagementUI";

type NavLink = { href: string; label: string; capability: string };
type NavItem = NavLink & { icon: IconName };
type NavGroup = { id: string; label: string; icon: IconName; items: readonly NavLink[] };
type NavEntry = NavItem | NavGroup;

/**
 * The console's map, grouped by the work rather than by the data model.
 *
 * Support is the queue somebody works all day, so it stays one press away.
 * Everything else sits under the question it answers: is this person or
 * property trustworthy (Trust & safety), who is this account (Accounts), what
 * is on the market (Marketplace), where is the money (Finance), and how is the
 * system set up (System). Every destination keeps its route and its capability;
 * a group with nothing the role can open is not drawn.
 */
const NAV = [
  { href: "/management", label: "Overview", capability: "view_dashboard", icon: "home" },
  { href: "/management/support", label: "Support", capability: "view_support", icon: "support" },
  {
    id: "trust",
    label: "Trust & safety",
    icon: "shield",
    items: [
      { href: "/management/verifications", label: "Verification queue", capability: "view_verifications" },
      { href: "/management/providers", label: "Verification history", capability: "view_properties" },
      { href: "/management/reports", label: "Reports", capability: "view_reports" },
    ],
  },
  {
    id: "accounts",
    label: "Accounts",
    icon: "users",
    items: [
      { href: "/management/users", label: "Users", capability: "view_users" },
      { href: "/management/artisans", label: "Artisans", capability: "view_users" },
      { href: "/management/account-deletions", label: "Account deletions", capability: "view_users" },
    ],
  },
  {
    id: "marketplace",
    label: "Marketplace",
    icon: "properties",
    items: [
      { href: "/management/properties", label: "Properties", capability: "view_properties" },
      { href: "/management/listings", label: "Listings", capability: "view_properties" },
      { href: "/management/rentals", label: "Rentals", capability: "view_rentals" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: "payments",
    items: [
      { href: "/management/payments", label: "Payments", capability: "view_payments" },
      { href: "/management/billing", label: "Billing", capability: "view_billing" },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: "settings",
    items: [
      { href: "/management/configuration", label: "Configuration", capability: "view_configuration" },
      { href: "/management/audit-logs", label: "Audit log", capability: "view_audit_logs" },
    ],
  },
] as const satisfies ReadonlyArray<NavEntry>;

const COLLAPSE_KEY = "management.sidebar";
const GROUPS_KEY = "management.sidebar.groups";

function isGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}

function isActive(pathname: string, href: string) {
  return href === "/management" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/** Where a page sits in the console: its group (when it has one) and its own name. */
export function managementLocation(pathname: string): { section: string; page: string } | null {
  for (const entry of NAV as readonly NavEntry[]) {
    if (isGroup(entry)) {
      const item = entry.items.find((link) => isActive(pathname, link.href));
      if (item) return { section: entry.label, page: item.label };
    } else if (isActive(pathname, entry.href)) {
      return { section: "", page: entry.label };
    }
  }
  if (pathname.startsWith("/management/profile")) return { section: "Your account", page: "Profile and security" };
  return null;
}

function activeGroupId(pathname: string) {
  const group = (NAV as readonly NavEntry[]).find(
    (entry) => isGroup(entry) && entry.items.some((link) => isActive(pathname, link.href)),
  );
  return group && isGroup(group) ? group.id : null;
}

function readStoredGroups(): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(GROUPS_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function storeGroups(groups: Set<string>) {
  try {
    window.localStorage.setItem(GROUPS_KEY, JSON.stringify([...groups]));
  } catch {
    // A private window keeps the groups for this visit only.
  }
}

export function ManagementShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { state, can, logout } = useManagement();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const active = activeGroupId(pathname);
    return new Set(active ? [active] : []);
  });
  const menuButton = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const loginPage = pathname === "/management/login";

  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSE_KEY);
    if (stored === "collapsed" || stored === "expanded") {
      setCollapsed(stored === "collapsed");
    } else {
      setCollapsed(window.matchMedia("(max-width: 80rem)").matches);
    }
    setExpanded((current) => new Set([...current, ...readStoredGroups()]));
  }, []);

  // A direct visit, a refresh or a link from another page lands with the
  // current page's group open, whatever was folded last time.
  useEffect(() => {
    const active = activeGroupId(pathname);
    if (!active) return;
    setExpanded((current) => (current.has(active) ? current : new Set(current).add(active)));
  }, [pathname]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      window.localStorage.setItem(COLLAPSE_KEY, next ? "collapsed" : "expanded");
      return next;
    });
  }, []);

  const toggleGroup = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      storeGroups(next);
      return next;
    });
  }, []);

  const focusMenuButton = useRef(false);
  const closeMenu = useCallback((returnFocus: boolean) => {
    focusMenuButton.current = returnFocus;
    setOpen(false);
  }, []);

  // The page behind the drawer is inert until the drawer has closed, so focus
  // can only go back to the Menu button once it has.
  useEffect(() => {
    if (open || !focusMenuButton.current) return;
    focusMenuButton.current = false;
    menuButton.current?.focus();
  }, [open]);

  // The phone drawer: Escape closes it, and it never outlives the phone layout.
  useEffect(() => {
    if (!open) return;
    navRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu(true);
    };
    const wide = window.matchMedia("(min-width: 801px)");
    const onWide = () => { if (wide.matches) setOpen(false); };
    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [closeMenu, open]);

  useEffect(() => {
    if (state.status === "signed_out" && !loginPage) router.replace("/management/login" as never);
    if (state.status === "signed_in" && loginPage) router.replace("/management" as never);
  }, [loginPage, router, state.status]);

  // The session probe is an enhancement on the login route, not a gate. In
  // production the API may be waking from sleep or unavailable; keeping the
  // form behind that request leaves an operator with no way to sign in.
  if (loginPage && state.status !== "signed_in") return children;
  if (state.status === "loading") {
    return <ShellWait message="Checking your Management session…" />;
  }
  if (loginPage || state.status === "signed_out") {
    return <ShellWait message="Opening Management sign in…" />;
  }

  const entries = (NAV as readonly NavEntry[]).flatMap((entry): NavEntry[] => {
    if (!isGroup(entry)) return can(entry.capability) ? [entry] : [];
    const items = entry.items.filter((item) => can(item.capability));
    return items.length ? [{ ...entry, items }] : [];
  });
  const isCollapsed = collapsed === true;
  const here = managementLocation(pathname);

  return (
    <div
      className={`management-app${isCollapsed ? " is-collapsed" : ""}`}
      data-ready={collapsed === null ? undefined : "true"}
    >
      <aside id="management-sidebar" className={`management-sidebar ${open ? "is-open" : ""}`}>
        <div className="management-brand">
          <div className="management-brand-identity">
            <span className="management-brand-mark" aria-hidden="true">DH</span>
            <div className="management-brand-copy">
              <strong>Danpa HQ</strong>
              <span>Management</span>
            </div>
          </div>
          <button
            type="button"
            className="management-collapse"
            onClick={toggleCollapsed}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={isCollapsed}
          >
            <Icon name="panel" />
          </button>
          <button type="button" className="management-drawer-close" onClick={() => closeMenu(true)} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>
        <nav aria-label="Management" ref={navRef}>
          <ul className="management-nav">
            {entries.map((item) => isGroup(item) ? (
              <NavGroupItem
                key={item.id}
                group={item}
                pathname={pathname}
                expanded={expanded.has(item.id)}
                railMode={isCollapsed && !open}
                onToggle={() => toggleGroup(item.id)}
                onNavigate={() => setOpen(false)}
              />
            ) : (
              <li key={item.href}>
                <Link
                  href={item.href as never}
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  className={`management-nav-item${isActive(pathname, item.href) ? " active" : ""}`}
                  onClick={() => setOpen(false)}
                  title={isCollapsed ? item.label : undefined}
                >
                  <Icon name={item.icon} />
                  <span className="management-nav-label">{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="management-sidebar-note">
          <ManagementAccountMenu
            user={state.user}
            collapsed={isCollapsed && !open}
            canManageProfile={can("manage_profile")}
            logout={logout}
            onNavigate={() => setOpen(false)}
          />
        </div>
      </aside>
      {open ? <div className="management-scrim" aria-hidden="true" onClick={() => closeMenu(false)} /> : null}
      <div className="management-workspace" inert={open || undefined}>
        <header className="management-mobile-header">
          <button
            ref={menuButton}
            type="button"
            className="management-menu-button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-controls="management-sidebar"
          >
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
              <path d="M3.5 6h13M3.5 10h13M3.5 14h13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>Menu</span>
          </button>
          <span className="management-mobile-title">{here?.page ?? "Management"}</span>
          <span className="management-brand-mark is-small" aria-hidden="true">DH</span>
        </header>
        <LocationContext.Provider value={here}>
          <NoticeProvider>
            <main id="main" tabIndex={-1} className="management-main">{children}</main>
          </NoticeProvider>
        </LocationContext.Provider>
      </div>
    </div>
  );
}

/**
 * A group in the sidebar. Open, it is a disclosure: the parent folds its pages
 * in and out, and stays open while one of them is the current page's home. In
 * the icon rail there is no room to unfold, so the same press shows the pages
 * in a small panel beside the rail instead.
 */
function NavGroupItem({
  group,
  pathname,
  expanded,
  railMode,
  onToggle,
  onNavigate,
}: {
  group: NavGroup;
  pathname: string;
  expanded: boolean;
  railMode: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLLIElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [flyoutTop, setFlyoutTop] = useState<number | null>(null);
  const containsActive = group.items.some((item) => isActive(pathname, item.href));
  const flyoutOpen = railMode && flyoutTop !== null;

  useEffect(() => { setFlyoutTop(null); }, [pathname, railMode]);

  useEffect(() => {
    if (!flyoutOpen) return;
    rootRef.current?.querySelector<HTMLElement>(".management-flyout a")?.focus();
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setFlyoutTop(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFlyoutTop(null);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [flyoutOpen]);

  function press() {
    if (!railMode) {
      onToggle();
      return;
    }
    if (flyoutOpen) {
      setFlyoutTop(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    setFlyoutTop(rect ? rect.top : 0);
  }

  const links = group.items.map((item) => {
    const active = isActive(pathname, item.href);
    return (
      <li key={item.href}>
        <Link
          href={item.href as never}
          aria-current={active ? "page" : undefined}
          className={`management-nav-child${active ? " active" : ""}`}
          onClick={() => { setFlyoutTop(null); onNavigate(); }}
        >
          {item.label}
        </Link>
      </li>
    );
  });

  return (
    <li
      ref={rootRef}
      className={`management-nav-group${expanded ? " is-open" : ""}${containsActive ? " has-active" : ""}`}
      onBlur={(event) => {
        if (flyoutOpen && !event.currentTarget.contains(event.relatedTarget as Node | null)) setFlyoutTop(null);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="management-nav-item management-nav-parent"
        aria-expanded={railMode ? flyoutOpen : expanded}
        aria-controls={railMode ? (flyoutOpen ? listId : undefined) : listId}
        title={railMode ? group.label : undefined}
        onClick={press}
      >
        <Icon name={group.icon} />
        <span className="management-nav-label">{group.label}</span>
        <svg className="management-nav-chevron" viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false">
          <path d="m8 5.5 4.5 4.5L8 14.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {railMode ? (
        flyoutOpen ? (
          <div className="management-flyout" style={{ top: flyoutTop ?? 0 }}>
            <span className="management-flyout-title">{group.label}</span>
            <ul id={listId}>{links}</ul>
          </div>
        ) : null
      ) : (
        <ul id={listId} className="management-nav-children" hidden={!expanded}>{links}</ul>
      )}
    </li>
  );
}

function ShellWait({ message }: { message: string }) {
  return (
    <div className="management-loading" role="status">
      <span className="management-brand-mark" aria-hidden="true">DH</span>
      <span>{message}</span>
    </div>
  );
}
