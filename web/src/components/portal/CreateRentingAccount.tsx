"use client";

import { useState } from "react";
import { chooseWorkspace, useSession } from "@/lib/session";
import { TypedConfirmation } from "@/components/workspace/TypedConfirmation";
import { Icon } from "./icons";

export function CreateRentingAccount({ menu = false, onCreated }: { menu?: boolean; onCreated?: () => void }) {
  const { refresh } = useSession();
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={menu ? "portal-menu-item" : "btn btn-primary"} role={menu ? "menuitem" : undefined} data-menu-item={menu || undefined} onClick={() => setOpen(true)}>
      {menu ? <Icon name="home" /> : null}Create Renting Account
    </button>
    <TypedConfirmation open={open} onClose={() => setOpen(false)} title="Create Renting Account" phrase="Rent account" confirmLabel="Create account"
      description="Add a renting account to your profile to apply for homes and manage your own tenancies. Your provider or artisan account stays intact. This does not create a tenancy or lease."
      onConfirm={async () => { await chooseWorkspace("tenant", "Rent account"); await refresh(); onCreated?.(); }} />
  </>;
}
