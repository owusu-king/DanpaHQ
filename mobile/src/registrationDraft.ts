/**
 * A registration in progress, held between the details screen and the code.
 *
 * The journey asks who somebody is *before* it proves their number: role, then
 * details, then the phone, then the account. The backend has not changed — an
 * account still exists only once `/me/registration/` is called with a ticket
 * from `/auth/verify/` — so the details have to wait somewhere while the SMS
 * arrives. They wait here, in memory, and nowhere else:
 *
 * - **Never in storage.** The draft carries a password. Secure storage would
 *   keep it past the session that typed it; a route param would put it in the
 *   web address bar. A killed app loses the draft, and the code screen falls
 *   back to the details screen with the ticket, which is the old path.
 * - **The ticket comes back here too.** If the server refuses a detail after
 *   the number is proved (an email already in use, a password it considers
 *   common) the person returns to the details with the reason on the field and
 *   the ticket kept, so fixing it creates the account without a second SMS.
 */

import { Platform } from "react-native";

import { apiFetch } from "@/api";
import type { Me } from "@/auth";
import { describeDevice } from "@/device";
import type { FieldErrors } from "@/formErrors";
import { chooseWorkspace } from "@/workspace";

export type AccountType = "tenant" | "provider";

export type RegistrationDetails = {
  accountType: AccountType;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  password: string;
};

type Draft = RegistrationDetails & {
  /** Set once the number is proved: the account can be created from details alone. */
  ticket: string;
  /** What the server refused, to be shown on the details screen. */
  errors: FieldErrors;
  summary: string;
};

let draft: Draft | null = null;

export function saveRegistrationDetails(details: RegistrationDetails): void {
  draft = { ticket: draft?.ticket ?? "", errors: {}, summary: "", ...details };
}

export function registrationDraft(): Readonly<Draft> | null {
  return draft;
}

/** The number is proved but a detail was refused: keep the proof, say why. */
export function returnDraftWithErrors(ticket: string, errors: FieldErrors, summary: string): void {
  if (!draft) return;
  draft = { ...draft, ticket, errors, summary };
}

export function clearRegistrationDraft(): void {
  draft = null;
}

/**
 * The one moment an account has just been created on this device.
 *
 * Read by the route gate while it renders, so the first signed-in frame already
 * knows to show the welcome rather than Home. In memory on purpose: a relaunch
 * forgets it, which is exactly the rule — the welcome is seen once, and a
 * returning person goes straight to where they belong.
 */
let justCreated: AccountType | null = null;

export function markAccountJustCreated(type: AccountType): void {
  justCreated = type;
}

export function accountJustCreated(): AccountType | null {
  return justCreated;
}

export function finishAccountWelcome(): void {
  justCreated = null;
}

export type CreatedSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  user: Me;
};

/**
 * Create the account: the one call that makes somebody a member.
 *
 * Unchanged from what the details screen always sent. A ticket means a number
 * proved minutes ago and no row behind it, and the response opens the first
 * session; no ticket means an unfinished account from before tickets, already
 * signed in, finishing itself.
 *
 * The workspace is chosen with the new token *before* the session is handed to
 * the app, so the first signed-in frame is already in the right experience. If
 * that second call fails the account still exists and the session is still
 * returned — a missed preference must never strand somebody who just joined.
 */
export async function submitRegistration({
  details,
  ticket,
  deviceFingerprint,
}: {
  details: RegistrationDetails;
  ticket: string;
  deviceFingerprint: string;
}): Promise<{ session: CreatedSession | null; me: Me | null }> {
  const created = await apiFetch<Partial<CreatedSession>>("/me/registration/", {
    method: "POST",
    anonymous: Boolean(ticket),
    body: {
      registration_ticket: ticket || undefined,
      account_type: details.accountType,
      first_name: details.firstName.trim(),
      last_name: details.lastName.trim(),
      date_of_birth: details.dateOfBirth,
      email: details.email.trim() || null,
      password: details.password,
      platform: Platform.OS,
      device_label: describeDevice(),
      device_fingerprint: deviceFingerprint,
    },
  });

  if (created.access_token && created.refresh_token && created.user) {
    const user = await chooseWorkspace(details.accountType, created.access_token).catch(() => created.user as Me);
    return {
      session: {
        access_token: created.access_token,
        refresh_token: created.refresh_token,
        expires_in: created.expires_in,
        user,
      },
      me: user,
    };
  }

  const me = await chooseWorkspace(details.accountType).catch(() => null);
  return { session: null, me };
}
