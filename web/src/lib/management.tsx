"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/apiBase";

export type ManagementUser = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  role: "operations_admin" | "support_admin";
  role_label: string;
  capabilities: string[];
  must_change_password: boolean;
  last_login: string | null;
};

export class ManagementFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "request_failed",
  ) {
    super(message);
    this.name = "ManagementFailure";
  }
}

const BASE_URL = API_BASE_URL;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ManagementRequestInit = RequestInit & {
  idempotencyKey?: string;
  maxAttempts?: number;
};

/** A fresh key, held stable across this management mutation's retries. */
export function managementIdempotentMutation(): Pick<
  ManagementRequestInit,
  "idempotencyKey" | "maxAttempts"
> {
  return { idempotencyKey: crypto.randomUUID(), maxAttempts: 3 };
}

function csrfToken(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem("management.csrf") ?? "";
}

export async function managementFetch<T>(
  path: string,
  init: ManagementRequestInit = {},
): Promise<T> {
  const { idempotencyKey, maxAttempts = 1, ...requestInit } = init;
  const method = (requestInit.method ?? "GET").toUpperCase();
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(method);
  const requestId = crypto.randomUUID();
  let lastFailure: ManagementFailure | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${BASE_URL}/management${path}`, {
        ...requestInit,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Client": "management",
          "X-Request-ID": requestId,
          ...(unsafe && csrfToken() ? { "X-Management-CSRF": csrfToken() } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          ...requestInit.headers,
        },
      });
      const body = response.status === 204 ? null : await response.json().catch(() => null);
      if (response.ok) {
        if (body?.csrf_token && typeof window !== "undefined") {
          window.sessionStorage.setItem("management.csrf", body.csrf_token);
        }
        return body as T;
      }

      const error = body?.error;
      lastFailure = new ManagementFailure(
        error?.message ?? "That Management request did not work.",
        response.status,
        error?.code,
      );
      if (!RETRYABLE_STATUS.has(response.status)) throw lastFailure;
    } catch (cause) {
      if (cause instanceof ManagementFailure && !RETRYABLE_STATUS.has(cause.status)) {
        throw cause;
      }
      if (!(cause instanceof ManagementFailure)) {
        lastFailure = new ManagementFailure(
          "Could not reach Management. Check your connection and try again.",
          0,
          "network_error",
        );
      }
    }

    if (attempt < maxAttempts) await sleep(2 ** attempt * 400);
  }

  throw lastFailure ?? new ManagementFailure("That Management request did not work.", 0);
}

type State =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "signed_in"; user: ManagementUser };

type Context = {
  state: State;
  login: (email: string, password: string) => Promise<ManagementUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (capability: string) => boolean;
};

const ManagementContext = createContext<Context | null>(null);

export function ManagementProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const response = await managementFetch<{ user: ManagementUser }>("/auth/session/");
      setState({ status: "signed_in", user: response.user });
    } catch (error) {
      if (error instanceof ManagementFailure && [401, 403].includes(error.status)) {
        setState({ status: "signed_out" });
        return;
      }
      setState({ status: "signed_out" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<Context>(
    () => ({
      state,
      refresh,
      login: async (email, password) => {
        const response = await managementFetch<{ user: ManagementUser }>("/auth/login/", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        setState({ status: "signed_in", user: response.user });
        return response.user;
      },
      logout: async () => {
        try {
          await managementFetch("/auth/session/", { method: "DELETE" });
        } finally {
          window.sessionStorage.removeItem("management.csrf");
          setState({ status: "signed_out" });
        }
      },
      can: (capability) =>
        state.status === "signed_in" && state.user.capabilities.includes(capability),
    }),
    [refresh, state],
  );

  return <ManagementContext.Provider value={value}>{children}</ManagementContext.Provider>;
}

export function useManagement() {
  const value = useContext(ManagementContext);
  if (!value) throw new Error("useManagement must be used inside ManagementProvider");
  return value;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
