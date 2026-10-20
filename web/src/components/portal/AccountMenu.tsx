"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { resolveWebEntry } from "@/lib/navigation";
import { chooseWorkspace, useSession, type Me, type Workspace } from "@/lib/session";

import { Avatar } from "./icons";

/**
 * The account control, and the one menu behind it.
 *
 * Deliberately a single component used by both rail and header placements. The
 * trigger changes shape and the popover changes anchor; everything behind it is
 * the same code, so account actions cannot drift between workspace modes.
 *
 * It is a popover, not a modal: an account menu is a small aside, and taking
 * the whole screen for it on a desktop portal would be a heavier gesture than
 * the action deserves.
 */
export function AccountMenu({
  me,
  collapsed,
  placement = "rail",
}: {
  me: Me;
  collapsed: boolean;
  placement?: "rail" | "header";
}) {
  const { activeContext } = useSession();
  const [open, setOpen] = useState(false);
  const [dropDown, setDropDown] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Outside click and Escape. Pointerdown rather than click so the menu closes
  // on the press, before whatever was underneath reacts to it.
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

  // The rail sits at the bottom of the viewport, so the menu opens upward. On a
  // short window there may not be room, and it flips rather than running off
  // the top where it cannot be reached.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const room = trigger.getBoundingClientRect().top;
    setDropDown(room < menu.offsetHeight + 16);
    menu.querySelector<HTMLElement>("[data-menu-item]")?.focus();
  }, [open]);

  /** Up and down move through the menu; Home and End jump to its ends. */
  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>("[data-menu-item]") ?? [],
    );
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
    else if (event.key === "Tab") setOpen(false);
  }

  return (
    <div className={`portal-account${placement === "header" ? " is-header" : ""}`} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`portal-account-trigger${collapsed ? " is-collapsed" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        // Collapsed, the button is just a circle, so it states who it is for.
        aria-label={collapsed ? `Account menu for ${me.display_name}` : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar
          name={me.display_name}
          size={collapsed ? 32 : 28}
          photoUrl={me.profile?.avatar_url}
        />
        {!collapsed ? (
          <>
            <span className="portal-account-identity">
              <span className="portal-account-name">{me.display_name}</span>
              <span className="portal-account-role">{roleLabel(me, activeContext)}</span>
            </span>
            <svg
              className="portal-account-caret"
              viewBox="0 0 20 20" width="14" height="14" fill="none"
              stroke="currentColor" strokeWidth="1.75"
              strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m6 12 4-4 4 4" />
            </svg>
          </>
        ) : null}
      </button>

      {open ? (
        <div
          ref={menuRef}
          className={`portal-menu${dropDown ? " is-below" : ""}${collapsed && placement === "rail" ? " is-beside" : ""}${placement === "header" ? " is-header" : ""}`}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
        >
          <div className="portal-menu-head">
            <Avatar name={me.display_name} size={36} photoUrl={me.profile?.avatar_url} />
            <div className="portal-menu-who">
              <strong>{me.display_name}</strong>
              {/* Email is optional at registration, so it is shown only when
                  there is one. The number is always there and is what they
                  sign in with, so it is the identifier that always shows. */}
              {me.email ? <span>{me.email}</span> : null}
              <span className="portal-menu-mono">{me.phone_display}</span>
            </div>
          </div>

          <div className="portal-menu-group">
            <Link
              href={"/settings" as never}
              className="portal-menu-item"
              role="menuitem"
              data-menu-item
              onClick={() => close(false)}
            >
              Settings
            </Link>
            <WorkspaceCrossing me={me} onDone={() => close(false)} />
            <ArtisanEntry me={me} onDone={() => close(false)} />
          </div>

          <div className="portal-menu-group">
            <SignOutItem />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What this person is here as.
 *
 * Read from capabilities, not `primary_role` — a provider holds no role until a
 * decision grants one, so `primary_role` is null for exactly the people this
 * line is most meant to describe.
 */
function roleLabel(me: Me, activeContext: string | null): string {
  if (me.capabilities.active_workspace === "artisan") {
    return me.capabilities.artisan.can_quote ? "Artisan" : "Artisan · suspended";
  }
  if (me.capabilities.active_workspace === "provider") {
    if (!me.capabilities.provider.workspace_access) return "Provider · in review";
    return me.contexts.find((context) => context.id === activeContext)?.label ?? "Provider";
  }
  return "Tenant";
}

const CROSSING_LABEL: Record<Exclude<Workspace, "discovery">, string> = {
  tenant: "Switch to renting",
  provider: "Switch to provider experience",
  artisan: "Switch to artisan experience",
};

/**
 * The way across, for an account holding more than one capability.
 *
 * It lives in this menu rather than in the rail because it is a property of the
 * account, not a destination — and because a bordered block in the rail had
 * nowhere to go once the rail could collapse to 68px. One row per experience
 * the backend says is open, so an approved artisan who also rents and lets
 * sees both ways out of whichever they are in.
 */
function WorkspaceCrossing({ me, onDone }: { me: Me; onDone: () => void }) {
  const router = useRouter();
  const { refresh } = useSession();
  const [switching, setSwitching] = useState<Workspace | null>(null);

  const others = me.capabilities.available_workspaces.filter(
    (workspace): workspace is Exclude<Workspace, "discovery"> =>
      workspace !== me.capabilities.active_workspace && workspace !== "discovery",
  );
  if (others.length === 0) return null;

  async function cross(workspace: Workspace) {
    setSwitching(workspace);
    try {
      const next = await chooseWorkspace(workspace);
      await refresh();
      onDone();
      router.push(resolveWebEntry(next) as never);
    } finally {
      setSwitching(null);
    }
  }

  return (
    <>
      {others.map((workspace) => (
        <button
          key={workspace}
          type="button"
          className="portal-menu-item"
          role="menuitem"
          data-menu-item
          disabled={switching !== null}
          onClick={() => void cross(workspace)}
        >
          {switching === workspace ? "Switching…" : CROSSING_LABEL[workspace]}
        </button>
      ))}
    </>
  );
}

/**
 * Where somebody asks to work as an artisan, from whichever experience they are
 * in — and where they follow the application afterwards. Gone once approved:
 * from then on the crossing above is the way in.
 */
function ArtisanEntry({ me, onDone }: { me: Me; onDone: () => void }) {
  const artisan = me.capabilities.artisan;
  if (artisan.workspace_access || me.capabilities.active_workspace === "artisan") return null;
  return (
    <Link
      href={"/artisan" as never}
      className="portal-menu-item"
      role="menuitem"
      data-menu-item
      onClick={onDone}
    >
      {artisan.status === "not_started" ? "Become an artisan" : "Your artisan application"}
    </Link>
  );
}

function SignOutItem() {
  const { signOut } = useSession();
  return (
    <button
      type="button"
      className="portal-menu-item is-quiet"
      role="menuitem"
      data-menu-item
      onClick={() => void signOut()}
    >
      Sign out
    </button>
  );
}
