"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * Units are managed from their Property rather than from a second nested index.
 *
 * Keeping this segment as an explicit route boundary is also important for the
 * development router: the two useful children are `/spaces/new` and
 * `/spaces/:spaceId`, while the segment itself simply returns to the Property.
 */
export default function PropertySpacesIndex() {
  const router = useRouter();
  const propertyId = useSearchParams().get("propertyId");

  useEffect(() => {
    router.replace(
      (propertyId
        ? `/record/property?id=${encodeURIComponent(propertyId)}`
        : "/properties") as never,
    );
  }, [propertyId, router]);

  return null;
}
