# Canonical user journeys

## Shared entry

```text
public root -> restore valid session or browse/search/listing anonymously
            -> Save/Contact/Apply/List -> Continue with phone -> OTP -> /me/
            -> shared profile if required -> intent if required
            -> validate last active context -> context home
```

## Tenant

`tenant home -> search -> listing -> viewing -> application -> lease -> rent
record -> notifications/account/trust`.

## Landlord

`landlord home -> owned/related property -> unit -> listing -> viewing requests
-> applications -> lease -> rent record -> notifications`.

## Agent

`agent home -> verification -> delegated properties/listings -> viewings ->
applications`. An agent cannot claim ownership through property creation.

## Property manager

Controlled role with no complete Phase 3 workspace. Route to the safe related
property workspace only after an explicit relationship; organization/portfolio
and invitation rules remain a product decision.

## Support and admin

Provisioned, email-verified staff principal -> separate email/password admin
session -> review/operations workspace. Consumer OTP and bearer tokens are not
accepted by reviewer endpoints. The backend checks staff permission and prevents
self-review. Production MFA remains a release gate.

Every journey must render loading, empty, offline, expired OTP, wrong OTP,
revoked session, incomplete onboarding and restricted account states explicitly.
Lost-number recovery is not represented as a working path.
