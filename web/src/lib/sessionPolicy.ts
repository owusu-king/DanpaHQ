import { isSessionRefusal } from "./auth";
import type { Me } from "./session";

export type SessionState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "unavailable" }
  | { status: "signed_in"; me: Me; stale?: boolean };

export function stateAfterFailure(cause: unknown, current: SessionState): SessionState {
  if (isSessionRefusal(cause)) return { status: "signed_out" };
  return current.status === "signed_in"
    ? { ...current, stale: true }
    : { status: "unavailable" };
}

export function shouldRestoreSession(requireSession: boolean, hint: string | null): boolean {
  return requireSession || hint === "1";
}
