import { redirect } from "next/navigation";

/**
 * Units are managed from their Property rather than from a second nested index.
 *
 * Keeping this segment as an explicit route boundary is also important for the
 * development router: the two useful children are `/spaces/new` and
 * `/spaces/:spaceId`, while the segment itself simply returns to the Property.
 */
export default async function PropertySpacesIndex({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/properties/${id}`);
}
