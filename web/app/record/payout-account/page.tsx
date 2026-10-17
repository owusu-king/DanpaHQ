"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * The settlement account is a Portfolio setting now (Settings › Settlement
 * account). An old link, with its Portfolio, lands there.
 */
export default function PayoutAccountRedirect() {
  const router = useRouter();
  const organization = useSearchParams().get("organization");

  useEffect(() => {
    router.replace(
      (organization
        ? `/settings/settlement?organization=${encodeURIComponent(organization)}`
        : "/settings/settlement") as never,
    );
  }, [organization, router]);

  return null;
}
