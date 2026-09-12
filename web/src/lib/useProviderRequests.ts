"use client";

/**
 * Every tenancy request this provider can see, from both places they arrive.
 *
 * Public applications come from one endpoint, private Unit requests ride on each
 * Portfolio, and the leases that may already exist against them from a third.
 * The list needs all of it, and so does the record the list opens — which is why
 * this is a hook rather than three calls written out twice.
 *
 * Newest first, because a request that arrived this morning is the one somebody
 * came here about.
 */

import { useCallback, useEffect, useState } from "react";

import { ApiFailure } from "@/lib/api";
import {
  getOrganizationPortfolio,
  listGrantedLeases,
  listOrganizations,
  listReceivedApplications,
  type Lease,
} from "@/lib/console";
import { useSession } from "@/lib/session";
import { requestCreatedAt, type RequestItem } from "@/lib/tenancyRequests";

export function useProviderRequests() {
  const { activeContext } = useSession();
  // One Portfolio: the one being operated. This used to read every Portfolio
  // the account belonged to and flatten them into a single list, so a request
  // from a personal Portfolio sat beside a company's while the company was on
  // screen — and answering it decided something the page was not about.
  const preferred = activeContext?.startsWith("organization:")
    ? activeContext.slice("organization:".length)
    : "";
  const [items, setItems] = useState<RequestItem[] | null>(null);
  const [error, setError] = useState("");
  const [unauthorised, setUnauthorised] = useState(false);

  const load = useCallback(async () => {
    // Blank first: a switch must not leave the previous Portfolio's requests on
    // screen while the next Portfolio's are still in flight.
    setItems(null);
    try {
      const organizations = await listOrganizations();
      const scope = organizations.find((row) => row.id === preferred) ?? organizations[0] ?? null;
      if (!scope) {
        setItems([]);
        setError("");
        return;
      }
      const [applications, leases, portfolio] = await Promise.all([
        listReceivedApplications(false, { organization: scope.id }),
        listGrantedLeases({ organization: scope.id }),
        getOrganizationPortfolio(scope.id),
      ]);

      const leaseByApplication = new Map<string, Lease>(
        leases.filter((lease) => lease.application).map((lease) => [lease.application!, lease]),
      );

      const publicItems: RequestItem[] = applications.map((application) => ({
        key: `application:${application.id}`,
        kind: "application",
        application,
        lease: leaseByApplication.get(application.id) ?? null,
      }));
      const privateItems: RequestItem[] = portfolio.tenancy_requests.map((request) => ({
        key: `private:${request.id}`,
        kind: "private",
        request,
      }));

      setItems(
        [...publicItems, ...privateItems].sort((a, b) =>
          requestCreatedAt(b).localeCompare(requestCreatedAt(a)),
        ),
      );
      setError("");
    } catch (cause) {
      if (cause instanceof ApiFailure && (cause.status === 401 || cause.status === 403)) {
        setUnauthorised(true);
        return;
      }
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load tenancy requests.");
      setItems([]);
    }
  }, [preferred]);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, error, unauthorised, reload: load };
}
