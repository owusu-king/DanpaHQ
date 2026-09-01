/**
 * Whether this installation has been introduced to Rooomly.
 *
 * **Local to the device, and nothing to do with the account.** Registration
 * state, workspace access, provider verification and profile completion are the
 * backend's, and `resolveEntryRoute` reads them. This flag answers one much
 * smaller question: has anybody on this phone already seen the introduction.
 *
 * That distinction matters because the two have opposite lifetimes. Signing out
 * does not un-introduce somebody, and signing in on a new phone does not mean
 * they have seen it. So this is never cleared on sign-out — see `auth.tsx`,
 * which clears the session and the pending intent and deliberately leaves this
 * alone.
 *
 * Kept in `secure` because it is the storage this app has. It is not a secret,
 * and if AsyncStorage is ever added this should move there; a keychain write
 * for a boolean is heavier than it needs to be, and it is the only reason this
 * module reads before the first frame.
 */

import { secure } from "@/secure";

const SEEN_KEY = "welcome.seen";

/** The value written. Versioned so a redesigned introduction can be shown again. */
const SEEN_VALUE = "1";

export async function hasSeenWelcome(): Promise<boolean> {
  try {
    return (await secure.get(SEEN_KEY)) === SEEN_VALUE;
  } catch {
    // A device that cannot read its keychain is not a reason to trap somebody
    // in an introduction forever, nor to show it twice. Treat it as seen: the
    // cost of skipping an introduction is far lower than the cost of blocking
    // the way in.
    return true;
  }
}

export async function rememberWelcomeSeen(): Promise<void> {
  try {
    await secure.set(SEEN_KEY, SEEN_VALUE);
  } catch {
    // Nothing to do. The worst case is that the introduction plays once more.
  }
}
