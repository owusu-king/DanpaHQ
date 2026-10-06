"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { Avatar, Icon, type IconName } from "@/components/portal/icons";
import { useSession } from "@/lib/session";
import { useGlide } from "@/lib/useGlide";

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
 *
 * The index is a glass card of its own: who you are at the top, then each
 * concern by name. A single tile glides to the one open, and a lighter one
 * follows the pointer, the way the rail does. There is no page header: the
 * index already says where you are.
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

  const index = useRef<HTMLElement>(null);
  const glide = useGlide(index, {
    link: ".settings-link",
    current: '.settings-link[aria-current="page"]',
    layoutKey: `${pathname}|${isProvider}|${Boolean(can?.view_billing)}|${Boolean(can?.operate_properties)}`,
  });

  return (
    <div className="ws-page settings-page">
      <div className="settings-shell">
        <nav
          ref={index}
          className="settings-index"
          aria-label="Settings"
          onPointerOver={glide.follow}
          onFocus={glide.follow}
          onPointerLeave={glide.rest}
          onBlur={glide.rest}
        >
          <span className="settings-tile is-current" aria-hidden="true" />
          <span className="settings-tile is-hover" aria-hidden="true" />

          {me ? (
            <div className="settings-who">
              <Avatar name={me.display_name} photoUrl={me.profile?.avatar_url ?? null} />
              <span>
                <strong>{me.display_name}</strong>
                <small>{isProvider ? portfolio?.label ?? "Provider" : me.capabilities.account_type === "provider" ? "Provider account" : "Tenant"}</small>
              </span>
            </div>
          ) : null}

          <div className="settings-group">
            <p className="settings-group-title">Account</p>
            <ul>
              <IndexLink href="/settings" pathname={pathname} icon="account">Profile</IndexLink>
              <IndexLink href="/settings/security" pathname={pathname} icon="lock">Security</IndexLink>
              <IndexLink href="/settings/preferences" pathname={pathname} icon="filters">Preferences</IndexLink>
              <IndexLink href="/settings/verification" pathname={pathname} icon="verification">Verification</IndexLink>
            </ul>
          </div>
          {isProvider ? (
            <>
              <div className="settings-group">
                <p className="settings-group-title">Portfolio</p>
                <ul>
                  <IndexLink href="/settings/team" pathname={pathname} icon="users">Team</IndexLink>
                  {can?.view_billing ?? true ? (
                    <IndexLink href="/settings/billing" pathname={pathname} icon="payments">Plan &amp; billing</IndexLink>
                  ) : null}
                  <IndexLink href="/settings/settlement" pathname={pathname} icon="landmark">Settlement account</IndexLink>
                </ul>
              </div>
              {can?.operate_properties ?? true ? (
                <div className="settings-group">
                  <p className="settings-group-title">Records</p>
                  <ul>
                    <IndexLink href="/settings/archive" pathname={pathname} icon="archive">Archive</IndexLink>
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
  icon,
  children,
}: {
  href: string;
  pathname: string;
  icon: IconName;
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
        <span className="settings-link-mark" aria-hidden="true"><Icon name={icon} /></span>
        <span className="settings-link-text">{children}</span>
      </Link>
    </li>
  );
}
