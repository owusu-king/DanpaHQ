"""Versioned provider terms and auditable, explicit acceptance."""

import hashlib

DEFAULT_PROVIDER_TERMS_VERSION = "2026-10-25"
DEFAULT_PROVIDER_TERMS = """Danpa HQ Provider Terms and Conditions

1. Scope and acceptance
These terms govern your use of Danpa HQ as a property owner, landlord, agent or property
manager. Accept them only if you are authorised to act for yourself or the business you
represent. Keep your account information accurate and protect your sign-in credentials.

2. Management approval
Registration creates a pending provider account. Provider operations remain restricted until
Management approves the account. Management may request clarification, reject an application or
withdraw approval for misuse or inaccurate information. Approval is permission to use provider
tools; it is not a government identity check, professional licence, guarantee of ownership or
endorsement of a property.

3. Property authority and verification
Submit only properties you own or have permission to manage, let or sell. Provide the documents,
photographs and information required for each property submission. Account approval does not
replace property verification. Keep advertisements, prices, availability and property
descriptions accurate, and correct misleading information promptly.

4. Your legal and professional responsibilities
Obtain and maintain any licences, registrations, permissions and insurance applicable to your
activities. Danpa HQ approval does not replace a licence required for real estate agency
services. You remain responsible for lawful tenancy arrangements, property safety, fair dealing
and obligations owed to owners, tenants, buyers and other counterparties.

5. Payments, fees and agreements
Review the price and terms shown before purchasing a plan or authorising a payment. Do not
represent a pending or failed payment as completed. Do not ask for passwords or one-time codes.
Agreements with tenants, owners and buyers remain separate from these platform terms. Danpa HQ
does not guarantee occupancy, a sale, rent collection or investment returns.

6. Privacy and responsible use
Use personal information available through the platform only for legitimate housing and account-
management purposes. Respect applicable privacy law, limit access to authorised people and do
not sell contact details or publish private documents. Danpa HQ uses submitted account
information to administer access, review applications, operate the service and maintain security
and audit records. Use Support Tickets to request access to or correction of your account
information, or raise a privacy concern. These terms do not waive statutory data-protection
rights.

7. Misuse and suspension
Do not submit forged records, impersonate another person, list a property without authority,
harass users or evade access controls. Management may restrict operations while reviewing a
concern. Existing agreements, payment obligations and records do not disappear when platform
access is restricted.

8. Support and disputes
Raise account or platform issues through Support Tickets. Cooperate with reasonable requests to
clarify your authority or correct a record. A platform review does not replace independent
professional advice or the lawful remedies available to any party.

9. Changes and records
Danpa HQ records the version, content fingerprint and time of your acceptance. Updated terms
will be presented when further acceptance is required. Material changes do not retrospectively
rewrite the version you accepted. You may stop using provider tools or request account closure
through the available account controls; lawful retention and existing obligations may continue.

10. Applicable rights
These terms apply subject to applicable Ghanaian law and do not exclude rights or obligations
that cannot lawfully be excluded. For questions about these terms or the identity of the service
operator, contact Management through Support Tickets.
"""


def policy():
    from apps.operations.configuration import value

    text = str(value("PROVIDER_TERMS_TEXT", DEFAULT_PROVIDER_TERMS)).strip()
    version = str(value("PROVIDER_TERMS_VERSION", DEFAULT_PROVIDER_TERMS_VERSION)).strip()
    return {
        "version": version,
        "text": text,
        "digest": hashlib.sha256(text.encode()).hexdigest(),
        "available": bool(version and text),
    }


def validate_acceptance(*, accepted, version, digest):
    from apps.core.exceptions import ValidationFailed

    current = policy()
    if not current["available"]:
        raise ValidationFailed("Provider terms are being updated. Please try again later.")
    if accepted is not True or version != current["version"] or digest != current["digest"]:
        raise ValidationFailed(
            "Read and accept the current provider Terms and Conditions.",
            details={"fields": {"provider_terms": ["Read and accept the current provider terms."]}},
        )
    return current
