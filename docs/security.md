# Security and data protection

What is true today, what is designed, and what is not done. The distinction is
the point of the document.

## In place (Phases 0-1)

| Control | Where |
|---|---|
| Deny-by-default API permissions | `REST_FRAMEWORK.DEFAULT_PERMISSION_CLASSES = [IsAuthenticated]`; public endpoints opt out explicitly |
| Argon2 password hashing | `PASSWORD_HASHERS`, with a 10-character minimum |
| Secrets from the environment, required in production | `config/settings/production.py` refuses to start without them |
| HSTS, secure cookies, SSL redirect, `nosniff`, `DENY` framing | production settings; matching headers in `next.config.mjs` |
| PII redaction in logs | `apps/core/logging.py` masks E.164 numbers and long digit runs before a line is emitted |
| Append-only audit in code, and a hash chain over every recorded field | `apps/audit` |
| Sensitive values never recorded in audit diffs | `apps.audit.services._scrub` |
| Files private by default, signed URLs only | `AWS_QUERYSTRING_AUTH = True`, 5-minute expiry |
| Uploads unusable until scanned | `file_stored.scan_status` |
| Idempotency for unsafe requests | `apps/idempotency` |
| Rate limit budgets defined, including a 5/hour OTP bucket | `DEFAULT_THROTTLE_RATES` |
| Non-root container, no build toolchain in the runtime image | `backend/Dockerfile` |
| Dependency and static analysis tools available locally | `pip-audit`, `bandit`, `ruff`, `npm audit`; no CI workflow is configured yet |

## Designed, not built

- **Database-level append-only audit is applied but not enforced.**
  `backend/apps/core/sql/audit_append_only.sql` enables and forces row-level security on
  `audit_log` with INSERT and SELECT policies only, so UPDATE and DELETE have no
  policy and are refused. That is correct — but the application connects as
  `grp`, the database owner, which is a superuser and therefore bypasses RLS
  entirely. The rules are in place and currently bite nobody.
  `manage.py harden_database` now says so out loud rather than reporting
  success.

  Enforcing it needs two roles: the owner for migrations, and a separate
  least-privilege role (`grp_app`, which the SQL already grants to) for the
  running application. That is a deployment change — two sets of credentials,
  and a migration step that runs as someone else — so it is recorded here as a
  decision to make rather than made silently. Until then the hash chain is the
  real control: it is tamper *evidence*, not tamper *prevention*, and
  `verify_chain` detects any edit to a recorded field.

- **SMS delivery is not automatically ready.** Arkesel is integrated, but
  production defaults to the null adapter until an administrator configures and
  live-tests it. The console adapter is development-only.
- **No SIM-swap data source.** Ghanaian operators expose SIM-change dates through
  aggregator APIs. `hours_since_sim_change_reported` is typed, documented and
  always `None` today; the rules degrade to signals we can see ourselves. It is
  not guessed at.
- **No document authenticity or liveness check.** Malware scanning is not the
  same as identity verification. A human reviews the uploaded image; forgery
  detection, face matching and NIA lookup are unbuilt.
- **Virus scanning requires deployment configuration.** The signed-upload flow
  rejects disallowed file signatures. `FILE_SCAN_MODE=cloudmersive` uses a real
  malware scan when an API key is configured; `strict` refuses new uploads, and
  production rejects the development-only `permissive` bypass. The free scanner
  accepts files up to 3.5 MB and sends their bytes to a third party; review its
  data-processing terms before using it for identity documents.
- Object-level permissions beyond "this is mine" — a landlord seeing only their
  own properties needs Phase 2 objects to attach to.
- Webhook signature verification and replay windows — Phase 5.
- Field-level encryption at rest for `national_id_hash` — currently a peppered
  hash, which resists a database dump but not an attacker who also has the
  application secret.
- Audit shipping to append-only external storage — Phase 4.
- Automated retention and erasure jobs. `identity.purge_expired_challenges` is
  written and scheduled; the broader erasure job driven by
  `file_stored.retain_until` is not.
- Account recovery for a lost number. Today, losing the number loses the account.

## Data protection posture

Ghana's Data Protection Act 2012 (Act 843) and the GDPR shape the design:
data minimisation, purpose limitation, retention limits, and user rights over
their own data. Concretely, in Phase 0:

- Identity documents are marked sensitive, get short-lived URLs, and carry a
  retention date.
- Account closure keeps the row (leases and payments reference it) and
  minimisation is a separate, audited job — deletion of a user record is not the
  same thing as erasure of their personal data, and conflating them breaks
  financial records.
- The audit log deliberately stores *that* a sensitive field changed, not its
  value.

**No compliance claim is made.** Registration with Ghana's Data Protection
Commission, a data protection impact assessment, a records-of-processing
register, and legal review of consent and retention are outstanding and are
prerequisites for handling real user data.

## Threats we are explicitly designing against

| Threat | Why it matters here | Response |
|---|---|---|
| Fake listings and fake agents | The single biggest trust failure in this market | Evidenced verification with expiry; trust state always visible, including "not checked" |
| Advance-fee scams | Two-year advance rent is normal, so the sums are large | Payments held against a verified lease; provider references retained |
| SIM swap | Phone is the credential | Step-up factor for money movement; re-verification on material actions |
| Duplicate/ghost accounts | Breaks rental history, enables re-listing after a ban | E.164 normalisation with a unique index |
| Insider tampering | The audit log is only as good as its integrity | Hash chain, database-level append-only, external shipping planned |
| Double charging on retries | Weak networks make retries constant | Idempotency keys; unsafe requests never auto-retry on the client |
| OTP brute force | Six digits is a million guesses, which is nothing to a script | Five attempts per challenge, surviving resends; 15-minute lockout |
| SMS pumping | Each code costs money and each resend is attack surface | Escalating resend cooldown (60s/120s/300s), hourly caps per number and per IP |
| Account enumeration | A "this number is registered" signal builds target lists | Identical response and identical error messages either way |
| Phished code replayed elsewhere | A code obtained for one purpose used for another | Codes are bound to their purpose and checked at verification |
| Session token theft | A stolen refresh token is a durable foothold | Rotation on every use; reuse revokes the whole family and tells the user |
| Reviewer self-approval | A reviewer approving their own agency | Object-level rule blocks deciding a check about yourself |

## Known residual risks

Stated because a security document that lists only what is handled is marketing.

1. **SMS interception.** SS7 attacks, malicious network insiders and a code
   glimpsed on a lock screen all defeat OTP. Step-up and the security hold limit
   the damage; they do not prevent the compromise.
2. **The pepper and the signing key live in the same secret store.** An attacker
   with application secrets *and* a database dump can forge tokens and test OTP
   hashes. Separating them into a KMS is a real improvement not yet made.
3. **Audit hash chains are evidence, not prevention.** Owner-level database
   access can recompute them.
4. **Human review is the weakest link in verification.** A tired reviewer
   approving a forged card is the most likely way a bad actor gets a stamp. The
   console mitigates it (equal weight for approve and reject, evidence required,
   claims, audit trail) but does not solve it.
5. **Device fingerprints are client-generated.** A determined attacker can
   present any fingerprint. They are a signal, not an authenticator.
6. **Nothing here has been penetration tested**, and no threat model has been
   reviewed by anyone outside the team.

## Reporting

Security issues go to a private contact, not a public issue tracker. The address
and disclosure policy are set before the first external user.
