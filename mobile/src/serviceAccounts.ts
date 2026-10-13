/**
 * The numbers a household reuses, and what it has bought with them.
 *
 * Buying airtime is a ten-second job that turns into a two-minute one every
 * time somebody has to find the meter card, so the point of this module is that
 * nobody types the same number twice. It is what makes a repeat purchase a tap.
 *
 * **Two stores, one interface, on purpose.**
 *
 * Saved details are *this device's* convenience and live here, in the same
 * secure store the session token uses — a meter number is not a secret, but it
 * is identifying, and phones in this market get lent to family. Nothing here
 * belongs in AsyncStorage for the same reason `secure.ts` gives.
 *
 * Purchase history is *the platform's* record and does not belong here at all.
 * When a service goes live its purchases become obligations settled through the
 * Payments Core, and the history a tenant sees must come from the server —
 * receipts, allocations and reconciliation live there and are the only account
 * that can be trusted eight months later. `listRecentPurchases` is that read
 * model's shape, returning empty until the endpoint exists, so the hub is
 * written against the real contract now rather than being rewritten around it.
 */

import { secure } from "@/secure";
import { serviceById, type Service } from "@/serviceCatalogue";

const STORE_KEY = "rooomly.service.details.v1";
let generation = 0;
let pendingWrite: Promise<void> = Promise.resolve();

export async function clearServiceDetails() {
  generation += 1;
  await pendingWrite.catch(() => undefined);
  await secure.clear(STORE_KEY);
}

export type SavedDetail = {
  serviceId: string;
  /** The meter/phone/smartcard number itself. */
  value: string;
  /** What the household calls it: "Upstairs meter", "Mum". Optional. */
  nickname: string;
  /** Epoch millis. Used to order and to answer "when did I add this?". */
  savedAt: number;
  /** Epoch millis of the last time it was used to buy something. */
  lastUsedAt: number | null;
  /** How many purchases it has carried. Orders the quick-access strip. */
  useCount: number;
};

export type RecentPurchase = {
  id: string;
  serviceId: string;
  /** The detail it was bought for, already masked for display. */
  maskedValue: string;
  amountMinor: number;
  currency: string;
  at: string;
  status: "succeeded" | "pending" | "failed";
  /** The Payments Core receipt, when there is one. */
  receiptId: string | null;
};

type Store = { details: SavedDetail[] };

async function read(): Promise<Store> {
  try {
    const raw = await secure.get(STORE_KEY);
    if (!raw) return { details: [] };
    const parsed = JSON.parse(raw) as Store;
    // A store written by a future version, or corrupted, must not take the hub
    // down with it. An empty list is always a valid answer here.
    return Array.isArray(parsed?.details) ? { details: parsed.details } : { details: [] };
  } catch {
    return { details: [] };
  }
}

async function write(store: Store, started: number): Promise<void> {
  const writing = pendingWrite.catch(() => undefined).then(async () => {
    if (started === generation) await secure.set(STORE_KEY, JSON.stringify(store));
  });
  pendingWrite = writing;
  await writing;
}

/** Everything saved, most-used first, then most-recently-added. */
export async function listSavedDetails(): Promise<SavedDetail[]> {
  const { details } = await read();
  return [...details].sort(
    (a, b) => b.useCount - a.useCount || (b.lastUsedAt ?? b.savedAt) - (a.lastUsedAt ?? a.savedAt),
  );
}

export async function detailsFor(serviceId: string): Promise<SavedDetail[]> {
  return (await listSavedDetails()).filter((detail) => detail.serviceId === serviceId);
}

/**
 * Save one, or update the nickname on one already held.
 *
 * Keyed on service *and* value, so adding the same meter twice corrects the
 * nickname instead of producing two rows that a person then has to tell apart.
 */
export async function saveDetail(input: {
  serviceId: string;
  value: string;
  nickname?: string;
}): Promise<SavedDetail[]> {
  const value = input.value.replace(/\s+/g, "");
  const started = generation;
  const store = await read();
  const existing = store.details.find(
    (detail) => detail.serviceId === input.serviceId && detail.value === value,
  );

  if (existing) {
    existing.nickname = input.nickname?.trim() ?? existing.nickname;
  } else {
    store.details.push({
      serviceId: input.serviceId,
      value,
      nickname: input.nickname?.trim() ?? "",
      savedAt: Date.now(),
      lastUsedAt: null,
      useCount: 0,
    });
  }

  await write(store, started);
  return listSavedDetails();
}

export async function forgetDetail(serviceId: string, value: string): Promise<SavedDetail[]> {
  const started = generation;
  const store = await read();
  store.details = store.details.filter(
    (detail) => !(detail.serviceId === serviceId && detail.value === value),
  );
  await write(store, started);
  return listSavedDetails();
}

/**
 * Record that a detail was used to buy something.
 *
 * Called after the Payments Core confirms, never before: the ordering of the
 * quick-access strip should reflect what a household actually pays for, not
 * what it started to pay for and abandoned.
 */
export async function markDetailUsed(serviceId: string, value: string): Promise<void> {
  const started = generation;
  const store = await read();
  const detail = store.details.find(
    (row) => row.serviceId === serviceId && row.value === value,
  );
  if (!detail) return;
  detail.useCount += 1;
  detail.lastUsedAt = Date.now();
  await write(store, started);
}

/**
 * What this household buys most, as services rather than numbers.
 *
 * Derived from use, not configured. A hub that lets somebody declare their
 * favourites is a hub asking them to do its job.
 */
export async function frequentServices(limit = 4): Promise<Service[]> {
  const details = await listSavedDetails();
  const used = details.filter((detail) => detail.useCount > 0);
  const seen = new Set<string>();
  const services: Service[] = [];
  for (const detail of used) {
    if (seen.has(detail.serviceId)) continue;
    const service = serviceById(detail.serviceId);
    if (!service) continue;
    seen.add(detail.serviceId);
    services.push(service);
    if (services.length === limit) break;
  }
  return services;
}

/**
 * The purchase history read model.
 *
 * Deliberately returns nothing rather than reading local storage. History is
 * the platform's record, not the device's: once a service settles through the
 * Payments Core its purchases carry a transaction, an allocation and a receipt,
 * and a locally-kept list beside them would be a second version of the truth
 * that nobody reconciles — exactly what the payment architecture spent its
 * effort preventing.
 *
 * When the first biller lands, this becomes one authenticated request and every
 * caller keeps working.
 */
export async function listRecentPurchases(_limit = 5): Promise<RecentPurchase[]> {
  return [];
}

/**
 * A saved number, shortened for a screen somebody else can see.
 *
 * Enough to recognise, not enough to copy: the last four, which is what a
 * person checks when they want to know whether this is the right meter.
 */
export function maskDetail(value: string): string {
  const compact = value.replace(/\s+/g, "");
  if (compact.length <= 4) return compact;
  return `•••• ${compact.slice(-4)}`;
}

/** What to call a saved detail in a list: its nickname, or its masked value. */
export function detailTitle(detail: SavedDetail): string {
  return detail.nickname || maskDetail(detail.value);
}
