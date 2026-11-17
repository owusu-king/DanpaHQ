"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { useAuthDialog } from "@/components/auth/AuthDialog";
import { Button } from "@/components/Button";
import { PageLoading } from "@/components/workspace/PageLoading";
import { resolveWebEntry } from "@/lib/navigation";
import { useSession } from "@/lib/session";

export function EntryRedirect({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { state, activeContext, refresh } = useSession();
  const { handlesNavigation } = useAuthDialog();

  useEffect(() => {
    if (!handlesNavigation && state.status === "signed_in") {
      router.replace(resolveWebEntry(state.me, activeContext) as never);
    }
  }, [activeContext, handlesNavigation, router, state]);

  if (state.status === "signed_out") return children;
  if (state.status === "unavailable") {
    return <section className="page-loading">
      <p role="alert">Danpa HQ couldn’t check your session.</p>
      <Button onClick={() => void refresh()}>Try again</Button>
      <Link href="/rentals">Browse properties</Link>
    </section>;
  }
  return <PageLoading label="Opening Danpa HQ" />;
}
