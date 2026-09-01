"""Progressive, property-scoped authorization.

Creating private inventory establishes a workspace claim, not verified ownership.
High-trust actions are recomputed from current identity, property authority and
payment checks every time they are attempted.

Two independent trust bases gate this, and conflating them was the mistake this
module now avoids:

* **Account verification** (phone + identity) answers *who is this person*. It is
  earned once, carried to every property they touch, and is what private
  management rests on: inviting your own tenants into your own building and
  recording the tenancy is a private arrangement between two people who have
  each other's phone numbers. The platform needs to know who the manager is; it
  does not need to have adjudicated the building.
* **Property authority** (per property) answers *does this person actually
  control this address*. It is what the public and the money rest on. An
  advertisement makes a claim to strangers who cannot check it, and rent
  collection moves their money, so both wait for a reviewed authority document.

So a manager with a verified account runs a private portfolio immediately, and
verifies authority per property only when they choose to advertise it or collect
rent through the platform. Neither basis substitutes for the other: authority
without identity is anonymous, and identity without authority is unproven.
"""

from __future__ import annotations

from enum import StrEnum

from apps.core.exceptions import PermissionDenied


class PropertyCapability(StrEnum):
    PRIVATE_INVENTORY = "private_inventory"
    TENANT_ACCESS = "tenant_access"
    LEASES = "leases"
    PAYMENT_COLLECTION = "payment_collection"
    PUBLICATION = "publication"


def _state(*, allowed: bool, missing: list[str], authorized: bool = True) -> dict:
    if allowed:
        value = "enabled"
    elif not authorized:
        value = "not_authorized"
    else:
        value = "verification_required"
    return {"allowed": allowed, "state": value, "missing": missing}


def _collection_missing(*, prop, user, cache: dict | None) -> list[str]:
    """What stands between this property and online rent collection.

    ``cache`` is how this stays constant-cost. The property serializer renders
    a whole prepared portfolio and the organization summary loops every
    property; without a shared answer for "which of this member's Portfolios
    hold a usable destination", each row would cost a query and the list would
    get slower as somebody's portfolio grew.
    """
    from apps.payments.payouts import collection_rail, ready_payout_organization_ids

    store = cache if cache is not None else {}
    if "collection_rail" not in store:
        store["collection_rail"] = collection_rail()
    provider, reason = store["collection_rail"]
    if provider is None:
        return [reason]
    if not provider.uses_subaccounts:
        return []

    if "ready_payout_organization_ids" not in store:
        store["ready_payout_organization_ids"] = ready_payout_organization_ids(
            user=user, provider_name=provider.name
        )
    ready = store["ready_payout_organization_ids"]
    if not ready:
        return ["payout_destination"]

    relationships = getattr(prop, "_property_list_organization_relationships", None)
    if relationships is None:
        organization_ids = prop.organization_relationships.filter(
            ended_at__isnull=True
        ).values_list("organization_id", flat=True)
    else:
        organization_ids = [row.organization_id for row in relationships]
    if any(str(organization_id) in ready for organization_id in organization_ids):
        return []
    return ["payout_destination"]


def property_capabilities(*, prop, user, cache: dict | None = None) -> dict[str, dict]:
    """Return actor-specific capabilities; no value is a persisted trust flag.

    ``cache`` is an optional per-request dictionary shared across a loop over
    several properties. It holds only answers that do not vary by property.
    """
    from apps.organization.services import can_manage_property

    privately_authorized = bool(user and user.is_authenticated) and can_manage_property(
        prop=prop, user=user
    )
    if not privately_authorized:
        return {
            capability.value: _state(allowed=False, missing=["property_access"], authorized=False)
            for capability in PropertyCapability
        }
    if user.is_staff:
        return {
            capability.value: _state(allowed=True, missing=[]) for capability in PropertyCapability
        }

    from apps.trust.models import SubjectType, VerificationKind
    from apps.trust.services import current_for

    phone = current_for(SubjectType.USER, user.id, VerificationKind.PHONE)
    identity = current_for(SubjectType.USER, user.id, VerificationKind.IDENTITY)
    authority = current_for(SubjectType.PROPERTY, prop.id, VerificationKind.PROPERTY_AUTHORITY)

    direct_authority = False
    authorized_organization_ids: list = []
    if authority is not None:
        actor_relationships = getattr(prop, "_property_list_actor_relationships", None)
        if actor_relationships is None:
            direct_authority = prop.relationships.filter(
                user=user,
                ended_at__isnull=True,
                authority_verification_id=authority.id,
                authority_verified_at__isnull=False,
            ).exists()
        else:
            direct_authority = any(
                relationship.authority_verification_id == authority.id
                and relationship.authority_verified_at is not None
                for relationship in actor_relationships
            )

        organization_relationships = getattr(
            prop, "_property_list_organization_relationships", None
        )
        if organization_relationships is None:
            from apps.organization.models import OrganizationPropertyRelationship

            authorized_organization_ids = list(
                OrganizationPropertyRelationship.objects.filter(
                    property=prop,
                    ended_at__isnull=True,
                    authority_verification_id=authority.id,
                    authority_verified_at__isnull=False,
                    organization__memberships__user=user,
                    organization__memberships__ended_at__isnull=True,
                ).values_list("organization_id", flat=True)
            )
        else:
            authorized_organization_ids = [
                relationship.organization_id
                for relationship in organization_relationships
                if relationship.authority_verification_id == authority.id
                and relationship.authority_verified_at is not None
                and relationship.organization._property_list_actor_memberships
            ]
    authority_for_actor = direct_authority or bool(authorized_organization_ids)

    # Who the actor is, and whether they may operate here at all. Provider
    # standing is included because a rejected or revoked provider must not keep
    # reaching tenants through a property they had already created — closing
    # that only in the navigation would leave the API itself still open.
    provider_standing = current_for(SubjectType.USER, user.id, VerificationKind.PROVIDER)

    account_missing: list[str] = []
    if phone is None:
        account_missing.append("phone")
    if identity is None:
        account_missing.append("identity")
    if provider_standing is None:
        account_missing.append("provider_standing")

    # Whether the actor's control of *this* property has been reviewed.
    #
    # Required on top of the account for anything a stranger sees or pays into —
    # and now for putting somebody in the building at all. Private tenant
    # management used to ask only who the manager was, on the reasoning that a
    # private arrangement makes no claim to strangers and that blocking it would
    # push the arrangement off the platform where nobody is protected.
    #
    # That reasoning gave away the wrong thing. A tenant handed keys to a
    # property nobody has confirmed the provider holds is exactly the person who
    # cannot check it themselves, and "it is private" is the framing under which
    # that goes unexamined. An unconfirmed claim is not a reason to move faster.
    property_missing = [*account_missing]
    if authority is None or not authority_for_actor:
        property_missing.append("property_authority")
    verified_property = not property_missing

    # Whether rent can actually be *collected through Rooomly* for this
    # property. This used to read a person's `BANK_ACCOUNT` trust stamp while
    # the payment path resolved a Portfolio's provider-verified destination, so
    # the two could disagree in either direction: a provider told payments were
    # not ready while checkout worked, or told they were ready while an intent
    # would fail closed. The payment module now owns the single answer and this
    # asks it. Recording an *off-platform* payment is deliberately not gated on
    # any of this — that money already changed hands outside Rooomly, and
    # `PropertyCapability.LEASES` is its authority.
    payment_missing = [*property_missing]
    if verified_property:
        payment_missing.extend(_collection_missing(prop=prop, user=user, cache=cache))

    return {
        PropertyCapability.PRIVATE_INVENTORY.value: _state(allowed=True, missing=[]),
        PropertyCapability.TENANT_ACCESS.value: _state(
            allowed=verified_property, missing=property_missing
        ),
        # Leases move with it. Gating invitations alone would leave the lease
        # path open, and drafting an agreement then activating it places a
        # tenant just as surely — a half-closed gate is an open one.
        PropertyCapability.LEASES.value: _state(
            allowed=verified_property, missing=property_missing
        ),
        PropertyCapability.PAYMENT_COLLECTION.value: _state(
            allowed=not payment_missing, missing=payment_missing
        ),
        PropertyCapability.PUBLICATION.value: _state(
            allowed=verified_property, missing=property_missing
        ),
    }


def assert_property_capability(*, prop, user, capability: PropertyCapability) -> None:
    result = property_capabilities(prop=prop, user=user)[capability.value]
    if result["allowed"]:
        return
    if result["state"] == "not_authorized":
        raise PermissionDenied("You are not authorized to perform this action for this property.")
    labels = {
        "phone": "phone verification",
        "identity": "identity verification",
        "provider_standing": "approved provider verification",
        "property_authority": "approved ownership or management authority",
        "payout_destination": ("a Portfolio settlement account the payment provider has verified"),
        "payment_rail": "an available payment provider",
    }
    named = [labels.get(item, item) for item in result["missing"]]
    requirements = named[0] if len(named) == 1 else f"{', '.join(named[:-1])} and {named[-1]}"
    raise PermissionDenied(f"Complete {requirements} before performing this action.")
