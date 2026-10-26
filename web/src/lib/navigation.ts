import type { Me, Workspace } from "./session";

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
 * ended up in the tenant experience. `contexts` always contains `discovery`,
 * whose route is `/rentals`, and `account.active_context` survives in
 * localStorage between sessions. So a stale `"discovery"` — left by any earlier
 * session — matched here and silently overrode the provider destination the
 * backend had just returned. A context now has to belong to the workspace the
 * person is actually in before it may speak.
 *
 * Discovery never speaks at all (owner, 2026-10-16). Browsing is a place to go
 * from the dashboard, not where an arrival lands: a remembered "discovery" sent
 * tenants to Explore after signing in, when they belong on their dashboard.
 */
export function resolveWebEntry(me: Me, activeContext?: string | null): string {
  if (me.account_status !== "active") return "/restricted";
  if (me.registration_state !== "complete") return "/register";

  const detailed = me.contexts.find((context) => context.id === activeContext);
  if (
    detailed
    && detailed.type !== "discovery"
    && contextBelongsToWorkspace(detailed.id, me.capabilities.active_workspace)
    && isReachable(me, detailed.web_route)
  ) {
    return detailed.web_route;
  }

  return me.entry_routes.web;
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
  if (route === "/properties") return me.capabilities.provider.workspace_access;
  return true;
}

export function resolveWebContextEntry(context: string): string {
  if (context.startsWith("organization:")) return "/properties";
  if (context.startsWith("occupancy:")) return "/rentals";
  return "/rentals";
}
