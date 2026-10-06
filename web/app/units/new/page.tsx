"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { PageHeader } from "@/components/portal/PageHeader";
import { PropertyChoices, usePropertyChoices } from "@/components/property/AddUnitChooser";

/**
 * A direct link's way into the same choice the Units page now asks in a modal
 * (`AddUnitButton`). Nothing here creates anything: it chooses, then hands over
 * to `/properties/${property.id}/spaces/new`, the flow Property → Add Unit uses.
 */
export default function AddUnitPage() {
  const router = useRouter();
  const choices = usePropertyChoices();
  const { load } = choices;

  // One eligible Property is not a choice (eligible.length === 1): go straight
  // to the flow. Eligibility is `private_inventory?.allowed`, decided in the chooser.
  useEffect(() => {
    void load().then((eligible) => {
      if (eligible.length === 1) router.replace(`/properties/${eligible[0]!.id}/spaces/new` as never);
    });
  }, [load, router]);

  return (
    <div className="units-workspace">
      <PageHeader
        title="Add Unit"
        description="Choose its Property."
        actions={<Link href={"/units" as never}>Back to Units</Link>}
      />
      <PropertyChoices choices={choices} />
    </div>
  );
}
