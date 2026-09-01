import type { Me, Workspace } from "@/auth";

/**
 * Where this person goes.
 *
 * The backend already decided: it knows the account state, the workspace they
 * chose, and the verification behind it, and returns the answer in
 * `entry_routes`. The client's only legitimate refinement is *which* of several
 * organizations or tenancies to open — a choice made inside an experience the
 * backend has already allowed.
 *
 * That refinement used to be applied unconditionally, and it was how a provider
 * ended up in the tenant tabs. `contexts` always contains `discovery`, whose
 * route is the tenant tab shell, and `account.active_context` survives in
 * storage between sessions. So a stale `"discovery"` — left by any earlier
 * session — matched here and silently overrode the provider destination the
 * backend had just returned. A context now has to belong to the workspace the
 * person is actually in before it may speak.
 */
export function resolveEntryRoute(me: Me, activeContext?: string | null): string {
  if (me.account_status !== "active") return "/(app)/restricted";
  if (me.registration_state !== "complete") return "/(auth)/register";

  const detailed = me.contexts.find((context) => context.id === activeContext);
  if (
    detailed
    && contextBelongsToWorkspace(detailed.id, me.capabilities.active_workspace)
    && isReachable(me, detailed.mobile_route)
  ) {
    return detailed.mobile_route;
  }

  return me.entry_routes.mobile || "/(app)/(tabs)";
}

/**
 * Which experience a context belongs to.
 *
 * Organizations are the provider side; tenancies are the tenant side; discovery
 * is browsing. A context from one experience must never redirect someone who is
 * in another.
 */
export function contextBelongsToWorkspace(
  contextId: string,
  workspace: Workspace,
): boolean {
  if (contextId.startsWith("organization:")) return workspace === "provider";
  if (contextId.startsWith("occupancy:")) return workspace === "tenant";
  if (contextId === "discovery") return workspace === "discovery" || workspace === "tenant";
  return false;
}

/** A context route is only offered if the workspace behind it is actually open. */
function isReachable(me: Me, route: string): boolean {
  if (route === "/(app)/(provider-tabs)") return me.capabilities.provider.workspace_access;
  return true;
}
