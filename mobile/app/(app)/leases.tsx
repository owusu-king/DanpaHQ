import { useAuth } from "@/auth";
import { ProviderAgreementsScreen } from "@/components/agreements/ProviderAgreements";
import { TenantAgreementsScreen } from "@/components/agreements/TenantAgreements";

/**
 * Tenancy agreements, for whichever side is reading.
 *
 * Accepting one commits real money — often a year of it up front — so the
 * review screen states the total before it offers the button, breaks it into
 * the parts it is made of, and says plainly when the advance exceeds what the
 * Rent Act allows. The list never offers the decision itself.
 *
 * Both sides read their agreements as work (owner, 2026-10-06): the provider's
 * rent roll, what waits on them and what is being signed in
 * `ProviderAgreements`; the tenant's decision, their home and its term in
 * `TenantAgreements`.
 */
export default function LeasesScreen() {
  const { state } = useAuth();
  const provider = state.status === "signed_in" &&
    state.me.capabilities.active_workspace === "provider" &&
    state.me.capabilities.provider.workspace_access;
  return provider ? <ProviderAgreementsScreen /> : <TenantAgreementsScreen />;
}
