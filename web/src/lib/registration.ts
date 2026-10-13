/**
 * The moment an account has just been created in this tab.
 *
 * The welcome is shown once, right after `/me/registration/` succeeds, and
 * never again. The flag lives in memory and, as a fallback, in this tab's
 * sessionStorage: the hand-off to `/welcome` can arrive as a full page load
 * (the first visit to a route the dev server has not compiled yet does exactly
 * that, and so does a reload at the wrong moment), and memory alone would lose
 * it. It holds only the account type and where to go next — never a detail of
 * the person — and the welcome clears it the moment it shows, so a reload, a
 * bookmark or a later visit finds nothing and sends the person on to wherever
 * they belong.
 *
 * The details typed before the number is proved (name, date of birth, the
 * password) are held by the register page itself, in component state, for the
 * same reason the mobile app holds them in memory: a password has no business in
 * storage or in an address bar.
 */

export type AccountType = "tenant" | "provider";

type Arrival = { type: AccountType; next: string | null };

const KEY = "rooomly.account_just_created";

let justCreated: Arrival | null = null;

function stored(): Arrival | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Arrival;
    return value.type === "tenant" || value.type === "provider"
      ? { type: value.type, next: typeof value.next === "string" && value.next.startsWith("/") ? value.next : null }
      : null;
  } catch {
    return null;
  }
}

export function markAccountJustCreated(type: AccountType, next: string | null = null): void {
  justCreated = { type, next };
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(justCreated));
  } catch {
    // Storage refused (a private window, say): memory still carries it.
  }
}

export function accountJustCreated(): Arrival | null {
  if (justCreated) return justCreated;
  if (typeof window === "undefined") return null;
  return stored();
}

export function finishAccountWelcome(): void {
  justCreated = null;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
