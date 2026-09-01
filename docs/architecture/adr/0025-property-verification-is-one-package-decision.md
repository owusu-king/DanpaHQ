# 25. Property verification is one package decision

**Status:** Accepted  
**Date:** 2026-08-21

## Problem

The current property-created-first flow correctly saved authority documents and
condition photographs before submission, then queued both from one provider
action. The review side did not preserve that aggregate boundary.

Internally, authority and condition are legitimately different evidence checks:

- authority documents answer whether the claimant may let the property;
- condition photographs answer whether the property is as described.

However, `PropertyProviderApplication.status` could become `APPROVED` as soon as
the authority check passed while condition remained pending or rejected. The
provider API repaired the symptom by deriving a worst-of-two lifecycle. The
management UI grouped both queue rows visually, then issued two independent
HTTP decisions. A failure on the second request could therefore leave a
half-approved property, and the dashboard counted both “Provider approvals” and
“Verification reviews” for the same submission.

Documents had consequently become a separate approval lifecycle even though
the provider submitted one property package.

## Options considered

### Replace both checks with one `Verification`

Rejected. Authority and condition evidence have different policies, review
meaning, expiry/revocation effects and downstream capabilities. Combining their
evidence into one generic row would erase useful trust history.

### Keep deriving a provider status from unrelated rows

Rejected. This retains the partial-decision transaction boundary and requires
every operations client to rediscover which rows belong together.

### Make the existing submission row the aggregate envelope

Chosen. `PropertyProviderApplication` already has one-to-one property scope,
submission timestamps, claimant context and preserved history. Its historical
class/database name is retained to avoid a destructive rename, but for a
property-created-first workflow it is the property verification submission.

## Decision

1. A property submission explicitly links both `authority_verification_id` and
   `condition_verification_id`.
2. The provider has one authoritative `verification.review_state`:

   ```text
   not_submitted
   → pending_verification
   → verified
   ```

   with `withdrawn`, `changes_required`, `rejected`, `suspended` and `expired`
   alternatives.
3. The existing detailed `verification.state` remains for setup routing and
   installed-client compatibility. Internal document/photo sections remain
   available for package completeness and targeted feedback, not as separate
   property outcomes.
4. Operations decides a property through one package endpoint. It locks the
   submission and both verification rows and decides them within one database
   transaction. For safe rollout, legacy individual-check endpoints delegate
   linked checks to that same atomic package service; they cannot decide only
   one half.
5. Only successful completion of both checks produces provider-facing
   `verified`. Authority approval may establish the evidenced management
   relationship, but cannot by itself make the submission successful.
6. Withdrawal is recorded as `WITHDRAWN`; the row and evidence are reused on
   resubmission. It is no longer represented as though submission never
   occurred.
7. The management dashboard counts a property package once and no longer shows
   a second “Provider approvals” queue for it.

## Migration impact

Migration `property.0011` adds a nullable unique
`condition_verification_id`. Existing applications are linked to the newest
non-superseded property-condition verification for their property. No
verification, queue, evidence, relationship or audit row is deleted or
rewritten.

Legacy authority-only applications that predate property-created-first remain
valid and continue through the generic verification decision endpoint. The
package endpoint requires both linked checks.

## Security impact

- A reviewer cannot grant the property trust mark by approving only authority
  or only photographs.
- Cached management clients using the former per-check API remain safe: either
  check ID resolves to the same package transaction and repeated requests with
  the same outcome are idempotent.
- Both evidence decisions and authority relationship materialisation commit or
  roll back together.
- Existing operations capabilities, evidence access controls and append-only
  audit records remain unchanged.
- Each internal decision still emits its trust audit/event record; the package
  additionally records and emits the authoritative property decision.

## Trade-offs

- Two internal verification rows still exist. This is deliberate evidence
  separation, not two provider-facing property states.
- The historical `PropertyProviderApplication` name is imperfect. Renaming it
  would add migration and import churn without improving runtime integrity.
- Old clients can continue reading detailed states, while new provider status
  UI must read `review_state`.

## Testing impact

Integration coverage must prove that:

- creation and evidence collection remain unsubmitted;
- one submission links and queues both checks;
- individual operations routes delegate linked checks to the package decision;
- one package decision approves or rejects both checks atomically;
- only the successful package result is `verified`;
- withdrawal preserves evidence, reports `withdrawn`, and remains resubmittable;
- management counts and renders one property decision.
