# Google Sign-In on mobile

Mobile obtains a Google ID token and posts it to the existing `/auth/google/`
endpoint. Django verifies it and either opens a normal Danpa HQ session or
returns a 15-minute registration ticket. A new Google account completes names
and date of birth without requiring a phone or password. Google identities are
linked by subject, never automatically merged by email.

## Deployment configuration

Use [the authoritative deployment guide](../docs/deployment.md), sections 1 and 5, for client IDs, native callbacks, signing and release builds. No deployment configuration is maintained here.

## Flow verification

Before release, test both platforms with the actual signing credentials:

1. Returning linked account; verify the same account and correct workspace open.
2. New tenant/provider; verify details, welcome, and existing verification gates.
3. Cancel account selection; retry without errors or unintended sign-in.
4. Existing email conflict; authenticate the original account, then connect
   Google from Security. No automatic merge should occur.
5. Add and verify an optional phone from Security; check wrong/expired codes.
6. Sign out, relaunch, switch Google accounts, refresh, and revoke another device.
7. Expired Google registration ticket, unavailable Play services, network loss,
   and simultaneous requests. Google API tokens must never authorize app calls.

The app keeps Google registration proof in memory, access tokens in memory, and
Danpa HQ refresh tokens in SecureStore. Refresh rotation, refusal handling,
single-flight requests, and inactivity expiry use the existing AuthProvider and
backend session pipeline.
