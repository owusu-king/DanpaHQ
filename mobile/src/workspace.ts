import { apiFetch } from "@/api";
import type { Me, Workspace } from "@/auth";

/**
 * Move between the tenant and provider experiences.
 *
 * Navigation only. The backend guarantees this touches no verification, revokes
 * no capability, ends no session and creates no second account — so a switcher
 * can be offered wherever `available_workspaces` allows it, without warning the
 * person that they are about to lose something.
 */
export function chooseWorkspace(workspace: Workspace, token?: string): Promise<Me> {
  return apiFetch<Me>("/me/workspace/", {
    method: "POST",
    body: { workspace },
    ...(token ? { token } : {}),
  });
}

export const WORKSPACE_LABELS: Record<Workspace, string> = {
  discovery: "Browsing",
  tenant: "Tenant",
  provider: "Provider",
};
