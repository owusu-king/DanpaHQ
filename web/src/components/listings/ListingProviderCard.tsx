"use client";

import { useState } from "react";
import { Icon } from "@/components/portal/icons";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { listingProvider } from "@/lib/listingProvider";
import type { ListingDetail } from "@/lib/listings";
import { STATE_LABEL, formatDecidedOn } from "@/lib/trust";

export function ListingProviderCard({ listing }: { listing: ListingDetail }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const { providers, identity, relationship, checks } = listingProvider(listing);
  const profileLabel = "View Profile";

  const people = providers.length ? providers.map((provider, index) => (
    <div className="listing-provider-person" key={`${provider.name}-${index}`}>
      <span className="listing-provider-avatar" aria-hidden="true"><Icon name="account" /></span>
      <div><strong>{provider.name}</strong><p>{provider.categoryLabel}</p></div>
    </div>
  )) : (
    <div className="listing-provider-person">
      <span className="listing-provider-avatar" aria-hidden="true"><Icon name="account" /></span>
      <div><strong>{listing.trust_stamps.relationship === "owner" ? "Property owner" : "Property representative"}</strong><p>{relationship}</p></div>
    </div>
  );

  const checkList = (
    <ul className="listing-provider-checks">
      {checks.map(check => (
        <li key={check.label} data-state={check.state}>
          <Icon name={check.icon} /><span>{check.label}</span>
          <span className="listing-provider-status">{check.status ?? STATE_LABEL[check.state]}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <section className="listing-provider" aria-label="Property provider">
        {identity === "verified" ? <div className="listing-provider-heading"><span className="listing-provider-badge"><Icon name="verification" />Verified identity</span></div> : null}
        <div className="listing-provider-summary">
          <div className="listing-provider-people">{people}</div>
          <button type="button" className="listing-provider-profile" onClick={() => setProfileOpen(true)}>{profileLabel}<span aria-hidden="true">→</span></button>
        </div>
      </section>
      <ModalSheet open={profileOpen} onClose={() => setProfileOpen(false)} title={providers.length > 1 ? "Provider profiles" : "Provider profile"} icon="account" size="sm" className="listing-provider-modal">
        <div className="listing-provider-profile-body">
          <div className="listing-provider-people">{people}</div>
          {providers.length ? <p className="listing-provider-caption">{relationship}</p> : null}
          {providers.length ? <div className="listing-provider-credentials">{providers.map((provider, index) => (
            <div key={`${provider.name}-${index}`}>
              <strong>{provider.name} · Provider Passport verified</strong>
              {provider.verified_at ? <p>Reviewed {formatDecidedOn(provider.verified_at)}</p> : null}
              {provider.valid_until ? <p>Valid until {formatDecidedOn(provider.valid_until)}</p> : null}
            </div>
          ))}</div> : <p className="listing-provider-caption">No public Provider Passport credentials have been published.</p>}
          <div className="listing-provider-verification"><p className="listing-provider-caption">Checks for this rental</p>{checkList}</div>
          <p className="listing-provider-caption">Supporting documents and personal contact details stay private.</p>
        </div>
      </ModalSheet>
    </>
  );
}
