"use client";

/**
 * A tenancy request opened from the list, over the list — and, once it is
 * accepted, the agreement prepared in the same sheet.
 *
 * One sheet for the whole journey rather than a second dialog stacked on the
 * first: "Prepare agreement" widens this one into the wizard (width by CSS,
 * height by the shared glide), and "Back to request" narrows it again. The page
 * owns the list; `onChanged` reloads it and the sheet reads the fresh request
 * back. The last request shown is held so the sheet can play its exit after the
 * page has let it go.
 */

import { useState } from "react";

import { LeaseWizard, type LeaseSpec } from "@/components/leases/LeaseWizard";
import { RequestRecord } from "@/components/requests/RequestRecord";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ModalViews, useModalViews } from "@/components/workspace/ModalViews";
import { requestWhere, requestWho, type RequestItem } from "@/lib/tenancyRequests";

export function RequestModal({
  item,
  portfolioName,
  onClose,
  onChanged,
}: {
  item: RequestItem | null;
  portfolioName: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [shown, setShown] = useState<RequestItem | null>(item);
  // The wizard is a deeper view of this sheet: it slides in, the sheet widens,
  // and Back returns to the request exactly as it was left.
  const nav = useModalViews<LeaseSpec>(Boolean(item), item?.key);
  // Adjusted while rendering rather than in an effect, so a reload shows the
  // new state in the same frame and a close keeps the old one for the exit.
  if (item && item !== shown) setShown(item);
  const current = item ?? shown;
  if (!current) return null;

  const who = requestWho(current);
  const spec = nav.top;
  const leave = () => { nav.back(); void onChanged(); };

  return (
    <ModalSheet
      open={Boolean(item)}
      onClose={onClose}
      size="sm"
      icon={spec ? "leases" : "applications"}
      // The person leads the record itself, so the header names what this is.
      title={spec ? "Tenancy agreement" : "Tenancy request"}
      meta={spec ? [who, spec.context?.propertyTitle, spec.context?.unitLabel].filter(Boolean).join(" · ") : requestWhere(current)}
      className={`request-sheet${spec ? " is-wizard" : ""}`}
      closeLabel={spec ? "Close agreement" : "Close request"}
      onBack={spec ? leave : undefined}
      backLabel="Back to request"
      viewKey={spec ? "wizard" : "request"}
    >
      {(close) => (
        <ModalViews depth={nav.depth} direction={nav.direction}>
          <RequestRecord
            key={current.key}
            item={current}
            portfolioName={portfolioName}
            onChanged={onChanged}
            onPrepareAgreement={nav.push}
          />
          {nav.views.map((view, index) => (
            <LeaseWizard key={`${current.key}-${index}`} spec={view} onExit={leave} onSent={() => onChanged()} onDone={close} />
          ))}
        </ModalViews>
      )}
    </ModalSheet>
  );
}
