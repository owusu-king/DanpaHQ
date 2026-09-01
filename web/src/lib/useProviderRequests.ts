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
import { requestCreatedAt, type RequestItem } from "@/lib/tenancyRequests";

export function useProviderRequests() {
  const [items, setItems] = useState<RequestItem[] | null>(null);
  const [error, setError] = useState("");
  const [unauthorised, setUnauthorised] = useState(false);

  const load = useCallback(async () => {
    try {
      const organizations = await listOrganizations();
      const [applications, leases, portfolios] = await Promise.all([
        listReceivedApplications(false),
        listGrantedLeases(),
        Promise.all(organizations.map((organization) => getOrganizationPortfolio(organization.id))),
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
      const privateItems: RequestItem[] = portfolios
        .flatMap((portfolio) => portfolio.tenancy_requests)
        .map((request) => ({ key: `private:${request.id}`, kind: "private", request }));

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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, error, unauthorised, reload: load };
}
