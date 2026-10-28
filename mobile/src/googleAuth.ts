/** Google proves identity; Danpa HQ alone creates accounts and app sessions. */
import { Platform } from "react-native";

import { apiFetch } from "@/api";
import type { Me } from "@/auth";
import { describeDevice } from "@/device";
import type { AccountType, CreatedSession } from "@/registrationDraft";
import { isMFAChallenge, type MFAChallenge } from "@/mfa";

export type GoogleRegistration = {
  registration_required: true;
  google_registration_ticket: string | null;
  expires_in: number;
  profile: { first_name: string; last_name: string; email: string };
};

export async function exchangeGoogleCredential(
  credential: string, accountType: AccountType | undefined, deviceFingerprint: string,
): Promise<GoogleRegistration | CreatedSession | MFAChallenge> {
  if (!credential || !deviceFingerprint) throw new Error("Could not start Google sign-in. Try again.");
  const result = await apiFetch<Partial<GoogleRegistration & CreatedSession> | MFAChallenge>("/auth/google/", {
    method: "POST", anonymous: true,
    body: {
      credential, account_type: accountType,
      platform: Platform.OS, device_label: describeDevice(), device_fingerprint: deviceFingerprint,
    },
  });
  if (isMFAChallenge(result)) return result;
  if (result.registration_required === true) {
    if ((accountType && !result.google_registration_ticket) || !result.profile?.email || !result.expires_in) {
      throw new Error("Google registration could not be started. Try again.");
    }
    return result as GoogleRegistration;
  }
  if (!result.access_token || !result.refresh_token || !result.user?.id || !result.expires_in) {
    throw new Error("Google sign-in returned an incomplete session. Try again.");
  }
  return result as CreatedSession;
}

export async function linkGoogleCredential(credential: string): Promise<Me> {
  return apiFetch<Me>("/me/google/", { method: "POST", body: { credential } });
}
