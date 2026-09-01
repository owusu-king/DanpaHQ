import test from "node:test";
import assert from "node:assert/strict";

import { contextBelongsToWorkspace, resolveWebEntry } from "./navigation.compiled.mjs";

/**
 * The discovery context is present for everyone, always — the backend prepends
 * it — and its route is the tenant-side listing page. That is what made a stale
 * stored context able to hijack a provider.
 */
const DISCOVERY = {
  id: "discovery",
  type: "discovery",
  label: "Find a property",
  mobile_route: "/(app)/(tabs)",
  web_route: "/rentals",
};

function provider({
  activeWorkspace = "provider",
  workspaceAccess = true,
  entry = "/properties",
  contexts = [DISCOVERY],
} = {}) {
  return {
    account_status: "active",
    registration_state: "complete",
    contexts,
    entry_routes: { web: entry, mobile: "/(app)/(provider-tabs)" },
    capabilities: {
      active_workspace: activeWorkspace,
      provider: { workspace_access: workspaceAccess, can_create_property: false },
      tenant: { workspace_access: false },
    },
  };
}

test("a stale discovery context cannot hijack a provider", () => {
  // The regression. `account.active_context` survives between sessions, so a
  // provider arrives carrying "discovery" from an earlier one. Before the fix
  // this returned /rentals and dropped them into the tenant experience.
  const me = provider();
  assert.equal(resolveWebEntry(me, "discovery"), "/properties");
});

test("a provider awaiting review still goes to the provider side", () => {
  const me = provider({ workspaceAccess: false, entry: "/provider" });
  assert.equal(resolveWebEntry(me, "discovery"), "/provider");
});

test("an organization context is honoured while in the provider workspace", () => {
  const organization = {
    id: "organization:abc",
    type: "organization",
    label: "Kwame Properties",
    mobile_route: "/(app)/(provider-tabs)",
    web_route: "/properties",
  };
  const me = provider({ contexts: [DISCOVERY, organization] });
  assert.equal(resolveWebEntry(me, "organization:abc"), "/properties");
});

test("an organization context is ignored while in the tenant workspace", () => {
  const organization = {
    id: "organization:abc",
    type: "organization",
    label: "Kwame Properties",
    mobile_route: "/(app)/(provider-tabs)",
    web_route: "/properties",
  };
  const me = provider({
    activeWorkspace: "tenant",
    contexts: [DISCOVERY, organization],
    entry: "/rentals",
  });
  assert.equal(resolveWebEntry(me, "organization:abc"), "/rentals");
});

test("an unapproved provider is never handed the provider console by a context", () => {
  const organization = {
    id: "organization:abc",
    type: "organization",
    label: "Kwame Properties",
    mobile_route: "/(app)/(provider-tabs)",
    web_route: "/properties",
  };
  const me = provider({
    workspaceAccess: false,
    entry: "/provider",
    contexts: [DISCOVERY, organization],
  });
  assert.equal(resolveWebEntry(me, "organization:abc"), "/provider");
});

test("account state and registration outrank every context", () => {
  const closed = { ...provider(), account_status: "deactivated" };
  assert.equal(resolveWebEntry(closed, "discovery"), "/restricted");

  const unfinished = { ...provider(), registration_state: "password_required" };
  assert.equal(resolveWebEntry(unfinished, "discovery"), "/register");
});

test("contexts are matched to the experience they belong to", () => {
  assert.equal(contextBelongsToWorkspace("organization:1", "provider"), true);
  assert.equal(contextBelongsToWorkspace("organization:1", "tenant"), false);
  assert.equal(contextBelongsToWorkspace("occupancy:1", "tenant"), true);
  assert.equal(contextBelongsToWorkspace("occupancy:1", "provider"), false);
  assert.equal(contextBelongsToWorkspace("discovery", "provider"), false);
  assert.equal(contextBelongsToWorkspace("discovery", "tenant"), true);
  assert.equal(contextBelongsToWorkspace("nonsense", "tenant"), false);
});
