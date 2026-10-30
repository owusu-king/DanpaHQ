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
  if (route === "/(app)/(artisan-tabs)") return me.capabilities.artisan.workspace_access;
  return true;
}


/** Routes a waiting account may open without mounting operational screens. */
export const BASIC_ACCOUNT_SCREENS = [
  "profile-edit", "security", "notification-settings", "help", "trust",
  "identity-verification", "provider", "artisan-application", "provider-property",
];

export function isPublicDiscovery(segments: readonly string[]): boolean {
  return segments[0] === "(app)" && (
    (segments[1] === "(tabs)" && segments[2] === "explore")
    || ["search", "listing", "sale"].includes(segments[1] ?? "")
  );
}

/** Enforce access before the nested app navigator can mount a feature. */
export function appAccessRedirect(me: Me | null, segments: readonly string[]): string | null {
  if (segments[0] !== "(app)") return null;
  const screen = segments[1] ?? "";
  const tab = segments[2] ?? "";
  const explore = screen === "(tabs)" && tab === "explore";
  if (!me) return isPublicDiscovery(segments) ? null : "/(auth)/sign-in";
  if (me.account_status !== "active") {
    return screen === "restricted" ? null : "/(app)/restricted";
  }
  if (me.registration_state !== "complete") return "/(auth)/register";
  const capabilities = me.capabilities;
  const pending = (capabilities.active_workspace === "provider" && !capabilities.provider.workspace_access)
    || (capabilities.active_workspace === "artisan" && !capabilities.artisan.workspace_access);
  if (pending) {
    const ownTabs = screen === `(${capabilities.active_workspace}-tabs)`;
    if (ownTabs || explore || BASIC_ACCOUNT_SCREENS.includes(screen)) return null;
    return resolveEntryRoute(me);
  }
  if (screen === "(tabs)" && !explore && !capabilities.tenant.workspace_access) {
    return resolveEntryRoute(me);
  }
  return null;
}
