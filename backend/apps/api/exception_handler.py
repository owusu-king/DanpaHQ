"""One error shape for the whole API.

DRF's default responses differ by exception class, which pushes the difference
onto every client. This flattens them into the envelope defined in
``apps.core.exceptions`` so the mobile app has one error path.
"""

from __future__ import annotations

import logging

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from rest_framework import exceptions as drf_exceptions
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_handler

from apps.core.context import get_context
from apps.core.exceptions import Conflict, DomainError, ValidationFailed

logger = logging.getLogger("api.error")

_DRF_CODES = {
    drf_exceptions.NotAuthenticated: ("not_authenticated", "Sign in to continue."),
    drf_exceptions.AuthenticationFailed: (
        "authentication_failed",
        "Those sign-in details did not work.",
    ),
    drf_exceptions.PermissionDenied: ("permission_denied", "You do not have access to this."),
    drf_exceptions.NotFound: ("not_found", "We could not find that."),
    drf_exceptions.Throttled: ("rate_limited", "Too many attempts. Wait a moment and try again."),
    drf_exceptions.MethodNotAllowed: ("method_not_allowed", "That action is not available here."),
    drf_exceptions.ParseError: ("malformed_request", "We could not read that request."),
}


#: Database constraints, in the words of the thing they protect.
#:
#: A constraint firing is the database refusing something the service layer
#: should ideally have caught first, and when one reaches here the person still
#: deserves to know *what* collided. Every entry names a rule the schema
#: actually enforces; anything unlisted falls back to a plain 409 rather than a
#: guess.
_CONSTRAINT_MESSAGES = {
    "occupancy_no_overlapping_unit_allocation": (
        "Someone is already recorded in this unit for those dates."
    ),
    "occupancy_no_overlapping_bed_allocation": (
        "Someone is already recorded in this bed for those dates."
    ),
    "occupancy_unique_active_user_unit": "This person is already recorded in this space.",
    "lease_one_live_per_unit": (
        "This unit already has a live agreement. End it before starting another."
    ),
    "lease_one_live_per_bed": (
        "This bed already has a live agreement. End it before starting another."
    ),
    "lease_one_acceptance_per_party": "That party has already accepted this agreement.",
    "property_unique_bed_label": (
        "There is already a bed with that label in this room. Give it a different one."
    ),
    "tenancy_one_live_per_unit_per_tenant": (
        "This person already holds a live tenancy of this space."
    ),
    "tenancy_one_live_per_bed_per_tenant": "This person already holds a live tenancy of this bed.",
    "org_unique_activity": "That activity is already on this workspace.",
}


def _integrity_message(exc) -> str:
    """What actually collided, when the constraint name tells us.

    Not "someone else changed this while you were working": that was the old
    blanket answer, and it was usually a lie. A duplicate bed label is not a
    concurrent edit, and telling somebody to reload sent them round a loop that
    could not fix it.
    """
    text = str(exc)
    for name, message in _CONSTRAINT_MESSAGES.items():
        if name in text:
            return message
    return ""


def handle(exc, context):
    request_id = get_context().request_id

    if isinstance(exc, DomainError):
        return Response(exc.to_payload(request_id), status=exc.status_code)

    if isinstance(exc, DjangoValidationError):
        failure = ValidationFailed(
            details={"fields": exc.message_dict if hasattr(exc, "message_dict") else exc.messages}
        )
        return Response(failure.to_payload(request_id), status=failure.status_code)

    if isinstance(exc, IntegrityError):
        logger.warning("integrity error", exc_info=exc, extra={"event": "db_integrity"})
        conflict = Conflict(_integrity_message(exc))
        return Response(conflict.to_payload(request_id), status=conflict.status_code)

    if isinstance(exc, drf_exceptions.ValidationError):
        failure = ValidationFailed(details={"fields": exc.detail})
        return Response(failure.to_payload(request_id), status=failure.status_code)

    response = drf_handler(exc, context)
    if response is None:
        # Unhandled: log with the stack, tell the user nothing about internals.
        logger.exception("unhandled exception", extra={"event": "unhandled_error"})
        return Response(
            {
                "error": {
                    "code": "server_error",
                    "message": "Something went wrong on our side. Try again shortly.",
                    "details": {},
                    "request_id": request_id,
                }
            },
            status=500,
        )

    code, message = _DRF_CODES.get(type(exc), ("request_failed", "That request did not work."))
    return Response(
        {
            "error": {
                "code": code,
                "message": message,
                "details": {"detail": response.data} if response.data else {},
                "request_id": request_id,
            }
        },
        status=response.status_code,
    )
