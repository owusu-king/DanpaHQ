"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { ManagementUser } from "@/lib/management";
import { Avatar } from "@/components/portal/icons";

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
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="portal-account management-account" ref={rootRef}>
      <button
        type="button"
        className={`portal-account-trigger management-account-trigger${collapsed ? " is-collapsed" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={collapsed ? `Account menu for ${user.display_name}` : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar name={user.display_name} size={collapsed ? 32 : 28} />
        {!collapsed ? (
          <>
            <span className="portal-account-identity">
              <span className="portal-account-name">{user.display_name}</span>
              <span className="portal-account-role">{user.role_label}</span>
            </span>
            <svg
              className="portal-account-caret"
              viewBox="0 0 20 20"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m6 12 4-4 4 4" />
            </svg>
          </>
        ) : null}
      </button>

      {open ? (
        <div
          className={`portal-menu management-account-menu${collapsed ? " is-beside" : ""}`}
          role="menu"
          aria-label="Management account"
        >
          <div className="portal-menu-head">
            <Avatar name={user.display_name} size={36} />
            <div className="portal-menu-who">
              <strong>{user.display_name}</strong>
              <span>{user.email}</span>
              <span>{user.role_label}</span>
            </div>
          </div>

          <div className="portal-menu-group">
            {canManageProfile ? (
              <Link
                href="/management/profile"
                className="portal-menu-item"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onNavigate();
                }}
              >
                Profile and security
              </Link>
            ) : null}
            <button
              type="button"
              className="portal-menu-item is-quiet"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void logout();
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
