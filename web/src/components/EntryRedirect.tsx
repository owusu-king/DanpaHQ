"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { resolveWebEntry } from "@/lib/navigation";
import { useSession, VISITED_KEY } from "@/lib/session";

export function EntryRedirect() {
  const router = useRouter();
  const { state, activeContext } = useSession();
  const checked = useRef(false);

  useEffect(() => {
    if (state.status === "signed_in") {
      router.replace(resolveWebEntry(state.me, activeContext) as never);
    } else if (state.status === "signed_out" && !checked.current) {
      checked.current = true;
      try {
        const visited = window.localStorage.getItem(VISITED_KEY);
        window.localStorage.setItem(VISITED_KEY, "1");
        if (visited) router.replace("/sign-in");
      } catch { /* A new browser can still use the public welcome. */ }
    }
  }, [activeContext, router, state]);

  return null;
}
