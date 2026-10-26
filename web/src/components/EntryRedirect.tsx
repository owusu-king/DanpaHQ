"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { resolveWebEntry } from "@/lib/navigation";
import { useSession } from "@/lib/session";

export function EntryRedirect() {
  const router = useRouter();
  const { state, activeContext } = useSession();

  useEffect(() => {
    if (state.status === "signed_in") {
      router.replace(resolveWebEntry(state.me, activeContext) as never);
    }
  }, [activeContext, router, state]);

  return null;
}
