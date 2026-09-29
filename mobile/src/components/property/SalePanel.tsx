/**
 * A property for sale, as its seller manages it on a phone: whether buyers can
 * see it, who has asked about it, and taking it off or back on the market.
 * The twin of the web `SalePanel.tsx`.
 *
 * Whether it is public is the server's answer (`is_public`), never worked out
 * here — public means verified *and* on the market, and those move separately.
 */

import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { ApiFailure } from "@/api";
import { Fact, GroupLabel, LinkRow, RecordPanel, type RecordTone } from "@/components/record/RecordSurfaces";
import { Button, Notice, space } from "@/components/ui";
import { setSaleStatus, type SellerSale } from "@/sales";

/** What the seller needs to know about who can see it, in one line and a tone. */
export function saleVisibility(sale: SellerSale, verified: boolean): { label: string; tone: RecordTone; note: string } {
  if (sale.status === "sold") return { label: "Sold", tone: "quiet", note: "Buyers no longer see it" };
  if (sale.status === "withdrawn") return { label: "Off the market", tone: "alert", note: "Buyers cannot see it" };
  if (sale.is_public) return { label: "Public on Explore", tone: "good", note: "Buyers can find it under Buy" };
  return {
    label: "Not public yet",
    tone: "waiting",
    note: verified ? "It will show on Explore shortly" : "Goes public once our team verifies it",
  };
}

export function SalePanel({
  propertyId,
  sale,
  verified,
  onChanged,
  onEdit,
}: {
  propertyId: string;
  sale: SellerSale;
  verified: boolean;
  onChanged: () => Promise<void>;
  /** Opens the price and description, once they are all that may change. */
  onEdit?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "withdraw" | "relist" | "sold">("");
  const [confirmingSold, setConfirmingSold] = useState(false);
  const [error, setError] = useState("");
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
    <View style={{ gap: space[2] }}>
      <GroupLabel>For sale</GroupLabel>
      <RecordPanel>
        <LinkRow
          first
          icon="chatbubbles-outline"
          tone={sale.enquiry_count ? "action" : "quiet"}
          label={sale.enquiry_count ? `${sale.enquiry_count} buyer ${sale.enquiry_count === 1 ? "enquiry" : "enquiries"}` : "No enquiries yet"}
          detail={sale.enquiry_count ? "Read and reply" : "Buyers' questions arrive here"}
          onPress={() => router.push({ pathname: "/(app)/enquiries", params: { as: "seller" } })}
        />
        {canEditPresentation && onEdit ? (
          <LinkRow
            icon="create-outline"
            label="Change the price or description"
            detail="Everything else was checked with the title"
            onPress={onEdit}
          />
        ) : null}
        {sale.headline ? <Fact wide label="Headline" value={sale.headline} /> : null}
      </RecordPanel>

      {error ? <Notice tone="error" title={error} /> : null}

      {verified && sale.status !== "sold" ? (
        <View style={{ gap: space[2], marginTop: space[2] }}>
          {sale.status === "active" ? (
            <Button
              label="Take off the market"
              variant="secondary"
              busy={busy === "withdraw"}
              busyLabel="Taking it off"
              onPress={() => void act("withdraw")}
            />
          ) : (
            <Button
              label="Put back on the market"
              busy={busy === "relist"}
              busyLabel="Relisting"
              onPress={() => void act("relist")}
            />
          )}
          {confirmingSold ? (
            <>
              <Notice
                tone="warning"
                title="Selling is final"
                body="It leaves Explore for good and its open enquiries close."
              />
              <Button label="Yes, it is sold" busy={busy === "sold"} busyLabel="Marking" onPress={() => void act("sold")} />
              <Button label="Not yet" variant="quiet" onPress={() => setConfirmingSold(false)} />
            </>
          ) : (
            <Button label="Mark as sold" variant="quiet" onPress={() => setConfirmingSold(true)} />
          )}
        </View>
      ) : null}
    </View>
  );
}
