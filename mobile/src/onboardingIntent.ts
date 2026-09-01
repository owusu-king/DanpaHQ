import { secure } from "@/secure";

export type OnboardingIntent = "find_property" | "current_tenant" | "manage_property";

const PENDING_INTENT_KEY = "onboarding.pending_intent";

export function asOnboardingIntent(value: string | null | undefined): OnboardingIntent | null {
  return value === "find_property" || value === "current_tenant" || value === "manage_property"
    ? value
    : null;
}

export async function rememberOnboardingIntent(intent: OnboardingIntent): Promise<void> {
  await secure.set(PENDING_INTENT_KEY, intent);
}

export async function pendingOnboardingIntent(): Promise<OnboardingIntent | null> {
  return asOnboardingIntent(await secure.get(PENDING_INTENT_KEY));
}

export async function clearPendingOnboardingIntent(): Promise<void> {
  await secure.clear(PENDING_INTENT_KEY);
}
