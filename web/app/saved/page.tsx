"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ListingCard } from "@/components/listings/ListingCard";
import { Notice } from "@/components/Notice";
import { Empty, LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import { unsavePublicListing } from "@/lib/listings";
import { listSavedListings, type SavedListing } from "@/lib/tenant";

/**
 * The shortlist.
 *
 * The API returns the whole listing on each saved row, so this renders with the
 * same card Explore and the public site use — a saved place should not look
 * like a different kind of object from the one that was saved.
 */
export default function SavedPage() {
  const [saved, setSaved] = useState<SavedListing[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void listSavedListings()
      .then(setSaved)
      .catch((cause) => {
        setSaved([]);
        setError(
          cause instanceof ApiFailure ? cause.error.message : "Could not load your shortlist.",
        );
      });
  }, []);

  async function removeSaved(listingId: string) {
    if (!saved) return;
    const previous = saved;
    setSaved((current) => current?.filter((row) => row.listing.id !== listingId) ?? []);
    setError("");
    try {
      await unsavePublicListing(listingId);
    } catch (cause) {
      setSaved(previous);
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not update your shortlist.",
      );
    }
  }

  return (
    <>
      <PageHeader title="Saved" description="Places you are keeping an eye on." />
      {error ? <Notice tone="error" title={error} /> : null}

      {saved === null ? (
        <LoadingRows rows={2} />
      ) : saved.length === 0 ? (
        <Empty
          title="Nothing saved yet"
          body="Save a place while you are looking and it waits here, so you can compare a shortlist instead of trying to remember."
          action={<Link href="/rentals" className="type-body-strong">Explore rentals →</Link>}
        />
      ) : (
        <ul
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 19rem), 1fr))",
            gap: "var(--space-5)",
            padding: 0,
            margin: 0,
            listStyle: "none",
          }}
        >
          {saved.map((row) => (
            <ListingCard
              key={row.id}
              listing={row.listing}
              saved
              onSave={() => void removeSaved(row.listing.id)}
            />
          ))}
        </ul>
      )}
    </>
  );
}
