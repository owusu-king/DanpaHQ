# ADR 0011 — SIM swap, step-up and the security hold

**Status:** accepted · 2026-08 · Phase 1

## Context
In Ghana the phone number is the credential *and* the payment rail. An attacker
who convinces a network to reissue a SIM gets both. This is the standard attack
against phone-first fintech across West Africa, and designing as if it were
exotic would be negligent.

## Decision
Three layered responses, all implemented in Phase 1 except where noted:

1. **Step-up.** A set of actions always requires a fresh code, whatever the
   session's age: changing the phone number, adding or changing a payout
   destination, withdrawing funds, deleting the account. Re-entering a code
   proves the person still holds the number *now* — which a borrowed unlocked
   phone does not.
2. **Security hold.** For 72 hours after a phone number change (or a reported SIM
   change), irreversible money movement is held. Not the whole account: reading,
   searching and messaging carry on. The user is told plainly what is held, why,
   and for how long.
3. **Device as a second signal.** An attacker with a reissued SIM almost never
   also has the victim's handset. A first sign-in from an unseen device raises
   risk and sends an SMS alert to the number — and that alert goes to the number
   that is *losing* access on a phone change, which is the whole point.

## What we cannot do yet, stated plainly
Ghanaian operators expose SIM-change dates through aggregator APIs. We have no
such integration, so `hours_since_sim_change_reported` is `None` and the rules
degrade to the signals we can see ourselves. The field exists, is typed, and is
documented as unpopulated rather than being guessed at from a prefix or an
assumption.

Similarly, `guess_network()` returns the original NCA prefix allocation with
`confident=False`, because number portability has made prefixes unreliable since
2011. Payment routing must ask the provider.

## Consequences
- A legitimate user who changes phones waits 72 hours before withdrawing. That is
  a real cost, accepted because the alternative cost is somebody's rent deposit.
- 72 hours is a guess informed by how long it takes someone to notice an SMS and
  call. It should be revisited against real incident data, not left as folklore.
- Step-up adds an SMS to every payout change, which costs money and adds friction
  exactly where friction is worth paying for.
