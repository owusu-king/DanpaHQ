"use client";

/**
 * A property for sale, as its seller manages it: whether buyers can see it, the
 * price they see, who has asked about it, and taking it off or back on the
 * market.
 *
 * It stands where a letting property shows its Units, because a sale has none —
 * it is sold whole (owner, 2026-09-28). Whether it is public is the server's
 * answer (`is_public`), never worked out here: public means verified *and* on
 * the market, and the two can change independently.
 */

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { ApiFailure } from "@/lib/api";
import { COMMERCIAL_USES, LAND_UNITS, saleFacts, setSaleStatus, type SellerSale } from "@/lib/sales";

import { SaleDetailsForm } from "./SaleDetailsForm";
import { DetailDisclosure, StatusLine, type StatusTone } from "./WorkspacePatterns";

function visibility(sale: SellerSale, verified: boolean): { label: string; tone: StatusTone; body: string } {
  if (sale.status === "sold") {
    return { label: "Sold", tone: "neutral", body: "Buyers no longer see it, and its open enquiries are closed." };
  }
  if (sale.status === "withdrawn") {
    return {
      label: "Off the market",
      tone: "attention",
      body: "Buyers cannot see it. Put it back on the market whenever you are ready.",
    };
  }
  if (sale.is_public) {
    return { label: "Public on Explore", tone: "good", body: "Buyers can find it under Buy and send you an enquiry." };
  }
  return {
    label: "Not public yet",
    tone: "waiting",
    body: verified
      ? "It will show on Explore shortly."
      : "It goes public by itself the moment our team verifies it. Nothing else to do.",
  };
}

export function SalePanel({
  propertyId,
  sale,
  verified,
  onChanged,
}: {
  propertyId: string;
  sale: SellerSale;
  verified: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"" | "withdraw" | "relist" | "sold">("");
  const [confirmingSold, setConfirmingSold] = useState(false);
  const [error, setError] = useState("");
  const shown = visibility(sale, verified);
  const facts = saleFacts({
    kind: sale.kind,
    bedrooms: sale.bedrooms,
    bathrooms: sale.bathrooms,
    floor_area_sqm: sale.floor_area_sqm,
    land_size: sale.land_size,
    land_size_unit_label: label(LAND_UNITS, sale.land_size_unit),
    commercial_use_label: label(COMMERCIAL_USES, sale.commercial_use),
  });
  // Price and words stay open once it is verified; the rest was checked.
  const canEditPresentation = verified && sale.status !== "sold" && sale.editable_fields.length > 0;

  async function act(action: "withdraw" | "relist" | "sold") {
    setBusy(action);
    setError("");
    try {
      await setSaleStatus(propertyId, action);
      setConfirmingSold(false);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not go through.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="workspace-section" aria-labelledby="sale-heading">
      <div className="workspace-section-head">
        <h2 id="sale-heading">For sale</h2>
        <StatusLine label={shown.label} tone={shown.tone} />
      </div>

      <div className="sale-panel">
        <div className="sale-panel-price">
          <strong>{sale.price_formatted ?? "No price yet"}</strong>
          {sale.price_negotiable && sale.price_formatted ? <span>Negotiable</span> : null}
        </div>
        {sale.headline ? <p className="sale-panel-headline">{sale.headline}</p> : null}
        {facts.length ? <p className="sale-panel-facts">{facts.join(" · ")}</p> : null}
        <p className="type-caption sale-panel-note">{shown.body}</p>

        <div className="sale-panel-enquiries">
          <span>
            <strong>{sale.enquiry_count}</strong>{" "}
            {sale.enquiry_count === 1 ? "enquiry" : "enquiries"}
          </span>
          {sale.enquiry_count ? (
            <Link href={"/enquiries?as=seller" as never} className="quiet-link">
              Read and reply →
            </Link>
          ) : null}
        </div>

        {error ? <Notice tone="error" title={error} /> : null}

        {verified && sale.status !== "sold" ? (
          <div className="sale-panel-actions">
            {sale.status === "active" ? (
              <Button
                variant="secondary"
                busy={busy === "withdraw"}
                busyLabel="Taking it off…"
                onClick={() => act("withdraw")}
              >
                Take off the market
              </Button>
            ) : (
              <Button busy={busy === "relist"} busyLabel="Relisting…" onClick={() => act("relist")}>
                Put back on the market
              </Button>
            )}
            {confirmingSold ? (
              <>
                <Button busy={busy === "sold"} busyLabel="Marking…" onClick={() => act("sold")}>
                  Yes, it is sold
                </Button>
                <Button variant="quiet" onClick={() => setConfirmingSold(false)}>
                  Not yet
                </Button>
              </>
            ) : (
              <Button variant="quiet" onClick={() => setConfirmingSold(true)}>
                Mark as sold
              </Button>
            )}
          </div>
        ) : null}
        {confirmingSold ? (
          <p className="type-caption sale-panel-note">
            Selling is final: it leaves Explore for good and its open enquiries close.
          </p>
        ) : null}
      </div>

      {canEditPresentation ? (
        <DetailDisclosure title="Change the price or description">
          <SaleDetailsForm propertyId={propertyId} sale={sale} saveLabel="Save changes" onSaved={onChanged} />
        </DetailDisclosure>
      ) : null}
    </section>
  );
}

function label(options: readonly (readonly [string, string])[], value: string): string {
  return options.find(([key]) => key === value)?.[1] ?? "";
}
