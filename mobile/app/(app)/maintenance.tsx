import { useAuth } from "@/auth";
import { ProviderMaintenanceScreen } from "@/components/maintenance/ProviderMaintenance";
import { TenantMaintenanceScreen } from "@/components/maintenance/TenantMaintenance";

/**
 * Maintenance, for whichever side is reading — one route, as on the web.
 *
 * Each side reads repairs as its own work (owner, 2026-10-06): a provider
 * what to start and fix, in `ProviderMaintenance`; a tenant what to confirm
 * and what waits on their landlord, in `TenantMaintenance`. Each request
 * opens its own record.
 */
export default function MaintenanceScreen() {
  const { state } = useAuth();
  const provider = state.status === "signed_in"
    && state.me.capabilities.active_workspace === "provider"
    && state.me.capabilities.provider.workspace_access;
  return provider ? <ProviderMaintenanceScreen /> : <TenantMaintenanceScreen />;
}
