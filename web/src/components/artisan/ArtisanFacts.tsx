"use client";

import { FileBadge, MapPin } from "lucide-react";

import { CERTIFICATE_LABEL, type ArtisanApplication } from "@/lib/artisan";
import { onDate } from "@/lib/time";

/**
 * An artisan's profile as plain facts: trades, area, their own words, photos of
 * their work and each certificate with its status. No score, no ranking — the
 * reader decides what the facts mean.
 */
export function ArtisanFacts({ profile }: { profile: NonNullable<ArtisanApplication["profile"]> }) {
  return (
    <div className="art-facts">
      <div className="art-facts-row">
        <span className="art-facts-label">Trades</span>
        <div className="art-tags">
          {profile.trades.map((trade) => <span key={trade.value} className="art-tag">{trade.label}</span>)}
        </div>
      </div>
      <div className="art-facts-row">
        <span className="art-facts-label">Area</span>
        <div className="art-tags">
          {profile.districts.map((district) => (
            <span key={district.id} className="art-tag is-place">
              <MapPin aria-hidden="true" />
              {district.name}
            </span>
          ))}
        </div>
      </div>
      {profile.bio ? (
        <div className="art-facts-row">
          <span className="art-facts-label">About</span>
          <p className="art-bio">{profile.bio}</p>
        </div>
      ) : null}
      {profile.portfolio.length ? (
        <div className="art-facts-row">
          <span className="art-facts-label">Work</span>
          <div className="art-gallery">
            {profile.portfolio.map((photo, index) =>
              photo.url ? (
                // A short-lived signed URL, which next/image would re-optimise every few minutes.
                // eslint-disable-next-line @next/next/no-img-element
                <img key={photo.id} src={photo.url} alt={`Work photo ${index + 1}`} loading="lazy" />
              ) : null,
            )}
          </div>
        </div>
      ) : null}
      <div className="art-facts-row">
        <span className="art-facts-label">Certificates</span>
        {profile.certificates.length ? (
          <ul className="art-certs">
            {profile.certificates.map((certificate) => (
              <li key={certificate.id}>
                <FileBadge aria-hidden="true" />
                <span>
                  <strong>{certificate.trade_label}</strong>
                  <small>
                    {certificate.issuing_body}
                    {certificate.expires_on ? ` · expires ${onDate(certificate.expires_on)}` : ""}
                  </small>
                </span>
                <span className={`art-cert-status is-${certificate.status}`}>
                  {CERTIFICATE_LABEL[certificate.status]}
                  {certificate.status === "verified" && certificate.verified_at ? ` ${onDate(certificate.verified_at)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="art-bio is-quiet">None added. Certificates are optional.</p>
        )}
      </div>
    </div>
  );
}
