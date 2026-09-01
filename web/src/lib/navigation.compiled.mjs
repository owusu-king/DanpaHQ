/* Test-only JS mirror of navigation.ts, kept in step by src/lib/navigation.test.mjs.
   Node runs .mjs with no build step; navigation.ts is the file that ships. */

export function resolveWebEntry(me, activeContext) {
  if (me.account_status !== "active") return "/restricted";
  if (me.registration_state !== "complete") return "/register";

  const detailed = me.contexts.find((context) => context.id === activeContext);
  if (
    detailed
    && contextBelongsToWorkspace(detailed.id, me.capabilities.active_workspace)
    && isReachable(me, detailed.web_route)
  ) {
    return detailed.web_route;
  }

  return me.entry_routes.web;
}

export function contextBelongsToWorkspace(contextId, workspace) {
  if (contextId.startsWith("organization:")) return workspace === "provider";
  if (contextId.startsWith("occupancy:")) return workspace === "tenant";
  if (contextId === "discovery") return workspace === "discovery" || workspace === "tenant";
  return false;
}

function isReachable(me, route) {
  if (route === "/properties") return me.capabilities.provider.workspace_access;
  return true;
}
