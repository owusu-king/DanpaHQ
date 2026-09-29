"use client";

import Link from "next/link";

import { Icon } from "@/components/portal/icons";
import { saleFacts, type SaleCard as Sale } from "@/lib/sales";

/**
 * A property for sale in the Buy grid.
 *
 * The rental card's frame — photograph, price, headline, where, a line of facts
 * — so Buy and Rent read as one Explore. What differs is what the facts are: a
 * house's rooms, a commercial building's use and floor area, land's size.
 * Every card here is verified; that is what put it on the page.
 */
export function SaleCard({ sale }: { sale: Sale }) {
  const where = [sale.locality_name, sale.district_name].filter(Boolean).join(", ");
  const href = `/sales/${sale.id}` as never;
  const facts = saleFacts(sale);

  return (
    <li className="listing-card card-interactive sale-card">
      <div className="listing-card-photo media">
        <Link href={href} className="listing-card-photo-link" aria-label={`Open ${sale.headline}`}>
          {sale.cover_url ? (
            <span className="listing-photo-track">
              <span className="listing-photo-slide">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sale.cover_url} alt="" loading="lazy" draggable={false} />
              </span>
            </span>
          ) : (
            <span className="listing-photo-empty"><Icon name="photos" />Photo pending</span>
          )}
        </Link>
        <span className="sale-card-kind">For sale · {sale.kind_label}</span>
      </div>

      <div className="listing-card-body">
        <div className="listing-card-price-row">
          <p className="listing-price">{sale.price_formatted ?? "Price on request"}</p>
          <p className="listing-advance">{sale.price_negotiable ? "Negotiable" : sale.tenure_label}</p>
        </div>

        <h3 className="listing-card-headline">
          <Link href={href}>{sale.headline || `${sale.kind_label} for sale`}</Link>
        </h3>

        <p className="listing-card-where">
          <Link href={href}>
            <Icon name="pin" />
            <span>{where || "Ghana"}</span>
          </Link>
        </p>

        {facts.length ? (
          <ul className="listing-card-facts" aria-label="Property essentials">
            {facts.map((fact) => <li key={fact}>{fact}</li>)}
          </ul>
        ) : null}

        <div className="listing-card-trust">
          <span className="listing-verified"><Icon name="verification" />Verified for sale</span>
          {sale.seller_label ? <span>{sale.seller_label}</span> : null}
        </div>
      </div>
    </li>
  );
}
