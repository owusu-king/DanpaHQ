import type { ListingDetail } from "./listings";
import type { SaleDetail } from "./sales";

export type IntelMessage = { role: "user" | "assistant"; text: string };
export type IntelProperty = { kind: "rental" | "sale"; id: string; title: string; location: string; facts: { label: string; value: string }[] };

export function rentalIntelContext(listing: ListingDetail): IntelProperty {
  return { kind: "rental", id: listing.id, title: listing.headline,
    location: [listing.property_context.locality_name, listing.property_context.district_name].filter(Boolean).join(", "),
    facts: [
      { label: "Rent", value: `${listing.rent_formatted} / month` },
      { label: "To move in", value: `GH₵${(listing.total_move_in_minor / 100).toLocaleString("en-GH")}` },
      { label: "Type", value: listing.space.space_type_label },
      { label: "Bedrooms", value: listing.space.bedrooms === 0 ? "Single room" : String(listing.space.bedrooms) },
      { label: "Description", value: listing.space.description },
    ] };
}

export function saleIntelContext(sale: SaleDetail): IntelProperty {
  return { kind: "sale", id: sale.id, title: sale.headline || `${sale.kind_label} for sale`,
    location: [sale.locality_name, sale.district_name].filter(Boolean).join(", "),
    facts: [
      { label: "Price", value: sale.price_formatted ?? "Price on request" },
      { label: "Type", value: sale.kind_label },
      { label: "Tenure", value: sale.tenure_label },
      { label: "Description", value: sale.description },
    ] };
}

export function propertyChatKey(actor: string, property: Pick<IntelProperty, "kind" | "id">) {
  return `danpa-intel:property:v1:${encodeURIComponent(actor)}:${property.kind}:${encodeURIComponent(property.id)}`;
}

export function readPropertyChat(raw: string | null): IntelMessage[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is IntelMessage => item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string" && item.text.length <= 6000).slice(-40).map(item => ({ role: item.role, text: item.text }));
  } catch { return []; }
}

/** No AI service is configured. Show sourced facts without pretending to infer an answer. */
export function propertyIntelReply(property: IntelProperty) {
  const facts = property.facts.filter(fact => fact.value).slice(0, 8).map(fact => `${fact.label}: ${fact.value.length > 600 ? `${fact.value.slice(0, 600)}…` : fact.value}`).join("\n");
  return `Your question is saved with ${property.title}. Live AI replies aren’t connected yet.\n\nPublished listing details:\n${[property.location, facts].filter(Boolean).join("\n")}`;
}
