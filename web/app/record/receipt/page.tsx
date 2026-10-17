"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * The receipt no longer has a page of its own: everything it showed is in the
 * receipt sheet (ReceiptModal), with Print and Download. A link to the old
 * address — a saved one, or one from an email — opens that sheet on Payments.
 */
export default function PaymentReceiptRedirect() {
  const router = useRouter();
  const receiptId = useSearchParams().get("receiptId");

  useEffect(() => {
    router.replace(
      (receiptId ? `/payments?receipt=${encodeURIComponent(receiptId)}` : "/payments") as never,
    );
  }, [receiptId, router]);

  return null;
}
