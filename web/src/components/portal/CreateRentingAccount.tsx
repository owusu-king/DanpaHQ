"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { chooseWorkspace, useSession } from "@/lib/session";
import { Icon } from "./icons";

/** Loaded on first use: it sits in the account menu of every portal page. */
const TypedConfirmation = dynamic(
  () => import("@/components/workspace/TypedConfirmation").then((module) => module.TypedConfirmation),
  { ssr: false },
);

export function CreateRentingAccount({ menu = false, onCreated }: { menu?: boolean; onCreated?: () => void }) {
  const { refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  return <>
    <button type="button" className={menu ? "portal-menu-item" : "btn btn-primary"} role={menu ? "menuitem" : undefined} data-menu-item={menu || undefined} onClick={() => { setRequested(true); setOpen(true); }}>
      {menu ? <Icon name="home" /> : null}Create Renting Account
    </button>
    {requested ? <TypedConfirmation open={open} onClose={() => setOpen(false)} title="Create Renting Account" phrase="TENANT"
      confirmationPrompt={<>Type <strong>TENANT</strong> to confirm your account creation</>} confirmLabel="Create account"
      onConfirm={async () => { await chooseWorkspace("tenant", "TENANT"); await refresh(); onCreated?.(); }} /> : null}
  </>;
}
