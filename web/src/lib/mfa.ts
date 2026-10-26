export type MFAChallenge = {
  mfa_required: true;
  challenge_token: string;
  stage: "enroll" | "verify" | "recovery";
  can_skip: boolean;
  expires_in: number;
  secret?: string;
  provisioning_uri?: string;
  qr_svg?: string;
  recovery_codes?: string[];
};

export type MFAConfirmation = {
  challenge_token: string;
  code?: string;
  action: "verify" | "skip" | "complete";
};

export function isMFAChallenge(value: unknown): value is MFAChallenge {
  return Boolean(value && typeof value === "object" && "mfa_required" in value
    && value.mfa_required === true && "challenge_token" in value
    && typeof value.challenge_token === "string");
}
