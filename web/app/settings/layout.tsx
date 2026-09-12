"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { PageHeader } from "@/components/portal/PageHeader";
import { useSession } from "@/lib/session";

/**
 * The Settings shell.
 *
 * Everything here used to be one `/account` page: standing, photo, name,
 * identity, password, checks and signed-in devices in a single scroll. Settings
 * is a product area, so the index names the concerns and each panel owns one.
 *
 * Team lives here too. It was briefly a primary destination; a provider does not
 * open it daily, and the rail is for what they do. Deciding who may operate the
 * business is settings work.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { state, activeContext } = useSession();
  const me = state.status === "signed_in" ? state.me : null;
  const isProvider =
    me?.capabilities.active_workspace === "provider" && me.capabilities.provider.workspace_access;
  // Which Portfolio this person is in, and what their role there may reach.
  // Team stays listed for every member — it is where somebody reads their own
  // role and standing — while the panels a role cannot use are not offered.
  const portfolio = me?.contexts.find(
    (context) => context.type === "organization" && context.id === activeContext,
  ) ?? me?.contexts.find((context) => context.type === "organization");
  const can = portfolio?.access?.can;

  return (
    <div>
      <PageHeader title="Settings" description="Your account, how Rooomly reaches you, and the records you keep." />
      <div className="settings-shell">
        <nav className="settings-index" aria-label="Settings">
          <div className="settings-group">
            <p className="type-label">ACCOUNT</p>
            <ul>
              <IndexLink href="/settings" pathname={pathname}>Profile</IndexLink>
              <IndexLink href="/settings/security" pathname={pathname}>Security</IndexLink>
              <IndexLink href="/settings/notifications" pathname={pathname}>Notifications</IndexLink>
              <IndexLink href="/settings/verification" pathname={pathname}>Verification</IndexLink>
            </ul>
          </div>
          {isProvider ? (
            <>
              <div className="settings-group">
                <p className="type-label">PORTFOLIO</p>
                <ul>
                  <IndexLink href="/settings/team" pathname={pathname}>Team</IndexLink>
                  {can?.view_billing ?? true ? (
                    <IndexLink href="/settings/billing" pathname={pathname}>Plan &amp; billing</IndexLink>
                  ) : null}
                </ul>
              </div>
              {can?.operate_properties ?? true ? (
                <div className="settings-group">
                  <p className="type-label">RECORDS</p>
                  <ul>
                    <IndexLink href="/settings/archive" pathname={pathname}>Archive</IndexLink>
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </nav>
        <div className="settings-panel">{children}</div>
      </div>
    </div>
  );
}

function IndexLink({
  href,
  pathname,
  children,
}: {
  href: string;
  pathname: string;
  children: React.ReactNode;
}) {
  // The root is exact; a concern remains selected while one of its focused
  // task pages is open (for example Verification → Identity).
  const current = href === "/settings"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
  const linkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (current) {
      linkRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [current]);

  return (
    <li>
      <Link ref={linkRef} href={href as never} className="settings-link" aria-current={current ? "page" : undefined}>
        {children}
      </Link>
    </li>
  );
}
