"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import type { ManagementUser } from "@/lib/management";
import { Avatar, Icon } from "@/components/portal/icons";

/**
 * Who is signed in, and the two things they can do about it.
 *
 * A disclosure rather than an ARIA menu: two ordinary controls that Tab reaches
 * in order. It opens above the account row (beside it in the icon rail), takes
 * focus to its first control, and Escape or a press elsewhere closes it, with
 * focus back on the row.
 */
export function ManagementAccountMenu({
  user,
  collapsed,
  canManageProfile,
  logout,
  onNavigate,
}: {
  user: ManagementUser;
  collapsed: boolean;
  canManageProfile: boolean;
  logout: () => Promise<void>;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>(".management-account-panel a, .management-account-panel button")?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div
      className="management-account"
      ref={rootRef}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`portal-account-trigger management-account-trigger${collapsed ? " is-collapsed" : ""}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={collapsed ? `Account: ${user.display_name}` : undefined}
        title={collapsed ? user.display_name : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar name={user.display_name} size={collapsed ? 32 : 30} />
        {!collapsed ? (
          <>
            <span className="portal-account-identity">
              <span className="portal-account-name">{user.display_name}</span>
              <span className="portal-account-role">{user.role_label}</span>
            </span>
            <svg className="portal-account-caret" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 12 4-4 4 4" />
            </svg>
          </>
        ) : null}
      </button>

      {open ? (
        <div id={panelId} className={`management-account-panel${collapsed ? " is-beside" : ""}`} aria-label="Your account">
          <div className="management-account-who">
            <Avatar name={user.display_name} size={36} />
            <div>
              <strong>{user.display_name}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <div className="management-account-role">
            <span>Role</span>
            <span className="management-status info">{user.role_label}</span>
          </div>
          <div className="management-account-actions">
            {canManageProfile ? (
              <Link
                href="/management/profile"
                className="management-account-action"
                onClick={() => {
                  setOpen(false);
                  onNavigate();
                }}
              >
                <Icon name="account" />
                <span>Profile and security</span>
              </Link>
            ) : null}
            <button
              type="button"
              className="management-account-action is-sign-out"
              disabled={leaving}
              onClick={() => {
                setLeaving(true);
                void logout().finally(() => setLeaving(false));
              }}
            >
              <Icon name="logout" />
              <span>{leaving ? "Signing out…" : "Sign out"}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
