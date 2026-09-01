"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useManagement } from "@/lib/management";
import { Icon, type IconName } from "@/components/portal/icons";
import { ManagementAccountMenu } from "./ManagementAccountMenu";

const NAV = [
  { href: "/management", label: "Dashboard", capability: "view_dashboard", icon: "home" },
  { href: "/management/verifications", label: "Verification queue", capability: "view_verifications", icon: "verification" },
  { href: "/management/users", label: "Users", capability: "view_users", icon: "users" },
  { href: "/management/providers", label: "Landlords & agents", capability: "view_properties", icon: "account" },
  { href: "/management/properties", label: "Properties", capability: "view_properties", icon: "properties" },
  { href: "/management/listings", label: "Listings", capability: "view_properties", icon: "listings" },
  { href: "/management/reports", label: "Reports", capability: "view_reports", icon: "reports" },
  { href: "/management/support", label: "Support", capability: "view_support", icon: "support" },
  { href: "/management/rentals", label: "Rental operations", capability: "view_rentals", icon: "leases" },
  { href: "/management/payments", label: "Payment operations", capability: "view_payments", icon: "payments" },
  { href: "/management/billing", label: "Billing", capability: "view_billing", icon: "payments" },
  { href: "/management/audit-logs", label: "Audit logs", capability: "view_audit_logs", icon: "audit" },
] as const satisfies ReadonlyArray<{
  href: string;
  label: string;
  capability: string;
  icon: IconName;
}>;

const COLLAPSE_KEY = "management.sidebar";

export function ManagementShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { state, can, logout } = useManagement();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  const loginPage = pathname === "/management/login";

  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSE_KEY);
    if (stored === "collapsed" || stored === "expanded") {
      setCollapsed(stored === "collapsed");
      return;
    }
    setCollapsed(window.matchMedia("(max-width: 80rem)").matches);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      window.localStorage.setItem(COLLAPSE_KEY, next ? "collapsed" : "expanded");
      return next;
    });
  }, []);

  useEffect(() => {
    if (state.status === "signed_out" && !loginPage) router.replace("/management/login" as never);
    if (state.status === "signed_in" && loginPage) router.replace("/management" as never);
  }, [loginPage, router, state.status]);

  if (state.status === "loading") {
    return <div className="management-loading">Securing Management Portal…</div>;
  }
  if (loginPage || state.status === "signed_out") return children;

  const visible = NAV.filter((item) => can(item.capability));
  const isCollapsed = collapsed === true;
  return (
    <div
      className={`management-app${isCollapsed ? " is-collapsed" : ""}`}
      data-ready={collapsed === null ? undefined : "true"}
    >
      <aside className={`management-sidebar ${open ? "is-open" : ""}`}>
        <div className="management-brand">
          <div className="management-brand-identity">
            <span className="management-brand-mark" aria-hidden="true">GR</span>
            <div className="management-brand-copy">
              <strong>Ghana Rental</strong>
              <span>Management Portal</span>
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
        </div>
        <nav aria-label="Management">
          {visible.map((item) => {
            const active = item.href === "/management"
              ? pathname === item.href
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href as never}
                aria-current={active ? "page" : undefined}
                className={active ? "active" : ""}
                onClick={() => setOpen(false)}
                title={isCollapsed ? item.label : undefined}
              >
                <Icon name={item.icon} />
                <span className="management-nav-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="management-sidebar-note">
          <ManagementAccountMenu
            user={state.user}
            collapsed={isCollapsed}
            canManageProfile={can("manage_profile")}
            logout={logout}
            onNavigate={() => setOpen(false)}
          />
        </div>
      </aside>
      <div className="management-workspace">
        <header className="management-mobile-header">
          <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            Menu
          </button>
          <strong>Management Portal</strong>
          <span>{state.user.first_name}</span>
        </header>
        {open ? <button className="management-scrim" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}
        <main id="main" className="management-main">{children}</main>
      </div>
    </div>
  );
}
