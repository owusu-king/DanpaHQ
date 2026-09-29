"use client";

/**
 * Conversations about properties for sale.
 *
 * A buyer never sees a seller's phone number (owner, 2026-09-28): they send an
 * enquiry, and the conversation lives here. A provider can be on both sides —
 * selling one plot while asking about another — so theirs has both, and opens on
 * the side their workspace suggests. A tenant account owns no property, so it
 * has only what it asked about (owner, 2026-09-29).
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Notice } from "@/components/Notice";
import { Empty, LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import { listEnquiries, type Enquiry } from "@/lib/sales";
import { useSession } from "@/lib/session";

export default function EnquiriesPage() {
  return (
    <Suspense fallback={<><PageHeader title="Enquiries" /><LoadingRows rows={3} /></>}>
      <Enquiries />
    </Suspense>
  );
}

function Enquiries() {
  const { state } = useSession();
  const router = useRouter();
  const search = useSearchParams();
  // Selling needs property, and only a provider account holds any.
  const canSell = state.status === "signed_in" && state.me.capabilities.provider.workspace_access;
  const provider = canSell && state.status === "signed_in" && state.me.capabilities.active_workspace === "provider";
  const asked = search.get("as");
  const side: "buyer" | "seller" = !canSell
    ? "buyer"
    : asked === "seller" || asked === "buyer" ? asked : provider ? "seller" : "buyer";

  const [rows, setRows] = useState<Enquiry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (state.status !== "signed_in") return;
    let live = true;
    setRows(null);
    listEnquiries(side)
      .then((result) => { if (live) { setRows(result); setError(""); } })
      .catch((cause) => {
        if (!live) return;
        setRows([]);
        setError(cause instanceof ApiFailure ? cause.error.message : "Could not load enquiries.");
      });
    return () => { live = false; };
  }, [side, state.status]);

  if (state.status === "loading") return <><PageHeader title="Enquiries" /><LoadingRows rows={3} /></>;
  if (state.status !== "signed_in") return null;

  return (
    <>
      <PageHeader
        title="Enquiries"
        description={side === "seller" ? "Buyers asking about what you are selling." : "Properties you asked to buy."}
      />

      {canSell ? (
      <div className="enquiry-sides" role="tablist" aria-label="Which side">
        {(["seller", "buyer"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={side === key}
            className="enquiry-side"
            onClick={() => router.replace(`/enquiries?as=${key}` as never, { scroll: false })}
          >
            {key === "seller" ? "Selling" : "Buying"}
          </button>
        ))}
      </div>
      ) : null}

      {error ? <Notice tone="error" title={error} /> : null}

      {rows === null ? (
        <LoadingRows rows={3} />
      ) : rows.length === 0 ? (
        side === "seller" ? (
          <Empty
            title="No enquiries yet"
            body="When a buyer asks about a property you are selling, it arrives here."
          />
        ) : (
          <Empty
            title="You have not asked about anything yet"
            body="Find a property under Buy on Explore and send the seller a message."
            action={<Link href={"/rentals?mode=buy" as never} className="button-link">Browse properties for sale</Link>}
          />
        )
      ) : (
        <ul className="enquiry-rows">
          {rows.map((row) => (
            <li key={row.id}>
              <Link href={`/enquiries/${row.id}` as never} className={`enquiry-row${row.unread ? " is-unread" : ""}`}>
                <span className="enquiry-row-main">
                  <span className="enquiry-row-title">{row.sale.headline || "Property for sale"}</span>
                  <span className="enquiry-row-meta">
                    {[
                      side === "seller" ? row.buyer_name : null,
                      row.sale.price_formatted,
                      row.sale.locality_name,
                    ].filter(Boolean).join(" · ")}
                  </span>
                  {row.last_message ? <span className="enquiry-row-last">{row.last_message}</span> : null}
                </span>
                <span className="enquiry-row-end">
                  {row.last_message_at ? <time dateTime={row.last_message_at}>{when(row.last_message_at)}</time> : null}
                  {row.status === "closed" || row.sale.status === "sold" ? (
                    <span className="enquiry-row-tag">{row.sale.status === "sold" ? "Sold" : "Closed"}</span>
                  ) : row.unread ? (
                    <span className="enquiry-row-tag is-new">New</span>
                  ) : null}
                </span>
                <span className="enquiry-row-arrow" aria-hidden="true">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function when(value: string): string {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}
