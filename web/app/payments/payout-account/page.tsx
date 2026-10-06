import { redirect } from "next/navigation";

/**
 * The settlement account is a Portfolio setting now (Settings › Settlement
 * account). An old link, with its Portfolio, lands there.
 */
export default async function PayoutAccountRedirect({ searchParams }: { searchParams: Promise<{ organization?: string }> }) {
  const { organization } = await searchParams;
  redirect((organization ? `/settings/settlement?organization=${encodeURIComponent(organization)}` : "/settings/settlement") as never);
}
