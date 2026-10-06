import type Ionicons from "@expo/vector-icons/Ionicons";

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Where a tenant buys the things a household needs, beside the rent.
 *
 * A declaration rather than markup: next quarter's service is one entry here
 * and no change to any screen. The hub, the service screen and the saved-detail
 * store all read from this.
 */

/**
 * Three tiers, and the difference between them is honesty about what exists.
 *
 * - `available` — the biller is integrated and money can move. Fully
 *   interactive, and it must never be set before both are true.
 * - `preparing` — the next set to be built. A tenant can open it, read what it
 *   will do, and **save the number it will need**, so the day it opens the
 *   purchase is one tap rather than a hunt for a meter card. That is a real
 *   thing to do today, which is why these are pressable and `later` is not.
 * - `later` — named so the roadmap is legible, and nothing more. Not a control.
 *
 * The rule that matters: `available` requires an integrated biller *and* a
 * configured payment rail. `apps.payments` registers no production adapter and
 * `create_intent` refuses before writing a row when one is missing, so a
 * service claiming to sell anything today would be a lie with a spinner on it.
 */
export type ServiceStatus = "available" | "preparing" | "later";

/**
 * The user-facing grouping, in the order the hub renders it. A category is a
 * name and nothing more: the tiles under it say the rest.
 */
export type ServiceCategory = "utilities" | "entertainment" | "connectivity" | "home";

/**
 * The colour a service carries.
 *
 * Semantic, not decorative: power is `harmattan` because the palette's amber
 * already means energy and caution across the product, water is `lagoon`
 * because it is the only blue, screens are `laterite`, and the network is
 * `kola` because connectivity is the thing Rooomly itself runs on — as are
 * referrals, which grow it. `ink` is for services that are labour rather than a
 * utility, and deliberately reads as quieter.
 */
export type ServiceTone = "harmattan" | "lagoon" | "laterite" | "kola" | "ink";

/**
 * What the biller needs to identify the account being paid.
 *
 * Held so the hub can offer a repeat purchase without asking again. A meter
 * number is not a secret but it *is* identifying, so it is stored the same way
 * this app stores anything identifying — see `serviceAccounts.ts`.
 */
export type IdentifierKind = "meter" | "phone" | "smartcard" | "account";

export type IdentifierSpec = {
  kind: IdentifierKind;
  /** What to call it on screen. "Meter number", not "identifier". */
  label: string;
  /** One line under the field. What the person should go and look at. */
  hint: string;
  keyboard: "number-pad" | "phone-pad" | "default";
  /** Rough length bounds. The biller is the real validator; this catches typos. */
  minLength: number;
  maxLength: number;
};

export type Service = {
  id: string;
  label: string;
  /** One line. If it needs two, it needs a screen, not a longer row. */
  summary: string;
  icon: IconName;
  category: ServiceCategory;
  status: ServiceStatus;
  tone: ServiceTone;
  /** What buying it will need. Absent for services that are a visit, not a top-up. */
  identifier?: IdentifierSpec;
  /**
   * What the tenant will be able to say when this opens. Shown on the service
   * screen so "preparing" is a description of something, not an apology.
   */
  promise: string;
  /** Where it opens, once it opens. Required for `available`, absent otherwise. */
  route?: string;
};

export const CATEGORIES: { id: ServiceCategory; label: string }[] = [
  { id: "utilities", label: "Utilities" },
  { id: "entertainment", label: "Entertainment" },
  { id: "connectivity", label: "Connectivity" },
  { id: "home", label: "Home" },
];

const PHONE: IdentifierSpec = {
  kind: "phone",
  label: "Phone number",
  hint: "The number to top up. Yours is offered first.",
  keyboard: "phone-pad",
  minLength: 9,
  maxLength: 13,
};

export const SERVICES: Service[] = [
  {
    id: "electricity",
    label: "Electricity",
    summary: "Prepaid meter top-up",
    icon: "flash-outline",
    category: "utilities",
    status: "preparing",
    tone: "harmattan",
    promise: "Buy ECG credit and get the token here, without queuing for a vendor.",
    identifier: {
      kind: "meter",
      label: "Meter number",
      hint: "Printed on the meter itself and on any previous token receipt.",
      keyboard: "number-pad",
      minLength: 8,
      maxLength: 16,
    },
  },
  {
    id: "water",
    label: "Water",
    summary: "Ghana Water bill",
    icon: "water-outline",
    category: "utilities",
    status: "later",
    tone: "lagoon",
    promise: "Settle a Ghana Water bill against your account number.",
  },
  {
    id: "dstv",
    label: "DStv",
    summary: "Renew your package",
    icon: "tv-outline",
    category: "entertainment",
    status: "preparing",
    tone: "laterite",
    promise: "Renew before it cuts off, on the package you already have.",
    identifier: {
      kind: "smartcard",
      label: "Smartcard number",
      hint: "On the back of the decoder, and on your last renewal message.",
      keyboard: "number-pad",
      minLength: 10,
      maxLength: 12,
    },
  },
  {
    id: "gotv",
    label: "GOtv",
    summary: "Renew your package",
    icon: "tv-outline",
    category: "entertainment",
    status: "preparing",
    tone: "laterite",
    promise: "Renew before it cuts off, on the package you already have.",
    identifier: {
      kind: "smartcard",
      label: "IUC number",
      hint: "On the back of the decoder, and on your last renewal message.",
      keyboard: "number-pad",
      minLength: 10,
      maxLength: 12,
    },
  },
  {
    id: "airtime",
    label: "Airtime",
    summary: "Any Ghanaian network",
    icon: "call-outline",
    category: "connectivity",
    status: "preparing",
    tone: "kola",
    promise: "Top up your own number or somebody else's, on any network.",
    identifier: PHONE,
  },
  {
    id: "data",
    label: "Mobile data",
    summary: "Bundles for a phone or router",
    icon: "cellular-outline",
    category: "connectivity",
    status: "preparing",
    tone: "kola",
    promise: "Buy a bundle for a phone or a router, on any network.",
    identifier: PHONE,
  },
  {
    id: "maintenance",
    label: "Maintenance",
    summary: "Report a fault to your landlord",
    icon: "construct-outline",
    category: "home",
    // Open: it takes no money, so it needs no biller — only its own screen
    // (apps.maintenance, 2026-10-05).
    status: "available",
    tone: "ink",
    promise: "Report a fault with photos, and follow what happens next.",
    route: "/(app)/maintenance",
  },
  {
    id: "cleaning",
    label: "Cleaning",
    summary: "Book a cleaner",
    icon: "sparkles-outline",
    category: "home",
    status: "later",
    tone: "ink",
    promise: "Book a vetted cleaner for a one-off or a regular slot.",
  },
  {
    id: "moving",
    label: "Moving",
    summary: "Help moving in or out",
    icon: "cube-outline",
    category: "home",
    status: "later",
    tone: "ink",
    promise: "Arrange a van and hands for a move-in or move-out day.",
  },
  {
    id: "referrals",
    label: "Referrals",
    summary: "Invite a tenant or landlord",
    icon: "person-add-outline",
    category: "home",
    status: "later",
    tone: "kola",
    promise: "Invite a tenant or landlord you know to Rooomly, and see where each invitation stands.",
  },
];

export function serviceById(id: string): Service | undefined {
  return SERVICES.find((service) => service.id === id);
}

export function servicesIn(category: ServiceCategory): Service[] {
  return SERVICES.filter((service) => service.category === category);
}

/** Everything a tenant can open — buy now, or set up ready for launch. */
export function openableServices(): Service[] {
  return SERVICES.filter((service) => service.status !== "later");
}

/**
 * What the hub's picker offers: services bought against an account number.
 * A service with a screen of its own (maintenance) opens from its tile instead —
 * "what do you need to buy?" is not where a leak is reported.
 */
export function purchasableServices(): Service[] {
  return openableServices().filter((service) => Boolean(service.identifier));
}

/**
 * How every one of these will take money: through the existing Payments Core.
 *
 * Stated here rather than left implicit, because the failure mode is each new
 * service growing its own checkout. Rooomly already has server-priced intents,
 * one open intent per obligation, immutable provider transactions, allocation,
 * a balanced ledger, receipts and reconciliation — and a second payment path
 * beside it would have none of that while looking, from a tenant's side,
 * exactly the same.
 *
 * What a service integration must therefore add is the *obligation*: a row that
 * says what is owed and to whom, which an intent can be priced from. It must
 * not add an intent, a transaction, a ledger or a receipt of its own.
 *
 * See `docs/architecture/PAYMENT_ARCHITECTURE.md` §25 and the payment
 * checkpoint's "reusable infrastructure" note.
 */
export const SETTLEMENT_ROUTE = "payments_core" as const;

/** Whether buying this will move money, as opposed to booking a visit. */
export function isPurchase(service: Service): boolean {
  return service.identifier !== undefined;
}
