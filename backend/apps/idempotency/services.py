"""Concurrent-safe HTTP idempotency for selected high-impact mutations.

**Transactional mode (the default).** The claim, domain write, outbox/audit
records and stored response commit in one transaction. A transaction-scoped
PostgreSQL advisory lock serialises the first request and every concurrent
replay before either reads the claim row. This is the important boundary:
committing the effect separately from its replayable response would still permit
a second execution after a lost connection.

**External-call mode (`external_calls=True`).** The same protocol, minus the one
thing it cannot have: a database transaction held open while the request talks
to a payment provider. That was ADR 0027's own stated constraint — "these
services must not wait on slow external providers" — and the payment endpoints
were violating it, pinning a connection and an advisory lock for up to the
provider's twenty-second timeout on every checkout, retry and status refresh.

So this mode commits in three steps: claim, run, record. Nothing is held while
the provider is answering.

The trade is explicit and must be understood before using it. Because the claim
commits first, a request that dies mid-flight leaves a committed `in_flight`
row, which needs a lease so the key does not become permanently unusable — and
taking over an expired lease **re-runs the request**. The effect is therefore
at-least-once, and this mode is only safe where the domain service is itself
idempotent on its own durable anchor. `payments.create_intent` is: it resumes
the open intent for that obligation rather than creating a second, and the
intent's `client_reference` is the provider's own idempotency key, so
re-initiating reaches the same provider transaction rather than a new one.

A 5xx is also not rolled back here, because the view has already committed its
own work and may have called a provider. It is recorded `failed` and may be
retried with the same key, which lands on the same resume path.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import timedelta
from functools import wraps

from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response

from apps.core.exceptions import Conflict, ValidationFailed

from .models import IdempotencyKey, IdempotencyStatus, fingerprint

KEY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$")


class IdempotencyConflict(Conflict):
    code = "idempotency_conflict"
    message = "That Idempotency-Key was already used for different request details."


class IdempotencyInProgress(Conflict):
    code = "idempotency_in_progress"
    message = "That request is still being processed. Try it again shortly."


def _ttl() -> timedelta:
    return timedelta(hours=int(getattr(settings, "IDEMPOTENCY_TTL_HOURS", 24)))


def _lease() -> timedelta:
    """How long an external-call claim is held before another request may take it.

    Comfortably longer than the provider timeout it exists to survive, so an
    ordinary slow response is never mistaken for an abandoned request.
    """
    return timedelta(seconds=int(getattr(settings, "IDEMPOTENCY_IN_FLIGHT_SECONDS", 90)))


def _endpoint(request) -> str:
    value = f"{request.method.upper()} {request.path}"
    if len(value) <= 200:
        return value
    digest = hashlib.sha256(value.encode()).hexdigest()[:16]
    return f"{value[:182]}#{digest}"


def _request_fingerprint(request) -> str:
    """Bind a key to its method, full target (including query) and raw body."""
    prefix = f"{request.method.upper()}\n{request.get_full_path()}\n".encode()
    return fingerprint(prefix + (request.body or b""))


def _scope(request, endpoint: str, key: str) -> tuple[object | None, str | None, str]:
    user = getattr(request, "user", None)
    actor = None
    management_actor_id = None
    if user is not None and getattr(user, "is_authenticated", False):
        if getattr(getattr(user, "_meta", None), "label_lower", "") == "identity.user":
            actor = user
            actor_scope = f"user:{user.id}"
        else:
            management_actor_id = str(user.id)
            actor_scope = f"management:{user.id}"
    else:
        actor_scope = "anonymous"
    return actor, management_actor_id, f"{actor_scope}:{endpoint}:{key}"


def _payload(response: Response):
    return json.loads(JSONRenderer().render(response.data))


def _resource_id(body, path: tuple[str, ...]) -> str:
    value = body
    for part in path:
        if not isinstance(value, dict):
            return ""
        value = value.get(part)
    return str(value) if value is not None else ""


def _replay(row: IdempotencyKey) -> Response:
    response = Response(row.response_body, status=row.response_status)
    response["X-Idempotent-Replay"] = "true"
    return response


def idempotent_mutation(
    *,
    required: bool = False,
    resource_type: str = "",
    resource_id_path: tuple[str, ...] = ("id",),
    external_calls: bool = False,
):
    """Protect one APIView mutation when an ``Idempotency-Key`` is supplied.

    Current non-payment endpoints keep the header optional for installed-client
    compatibility. Web and mobile send it for protected operations.

    ``external_calls=True`` selects the mode that does not hold a transaction
    across the request — required for any view that talks to a payment provider,
    and safe only for a service that is independently idempotent. See the module
    docstring for the trade it makes.
    """

    def decorate(view_method):
        @wraps(view_method)
        def wrapped(view, request, *args, **kwargs):
            raw_key = str(request.headers.get("Idempotency-Key", "")).strip()
            if not raw_key:
                if required:
                    raise ValidationFailed("Send an Idempotency-Key with this request.")
                return view_method(view, request, *args, **kwargs)
            if not KEY_PATTERN.fullmatch(raw_key):
                raise ValidationFailed(
                    "Idempotency-Key must be 16 to 128 letters, numbers, dots, colons, "
                    "underscores or hyphens."
                )

            endpoint = _endpoint(request)
            request_fingerprint = _request_fingerprint(request)
            actor, management_actor_id, lock_scope = _scope(request, endpoint, raw_key)

            if external_calls:
                return _run_with_external_calls(
                    view=view,
                    view_method=view_method,
                    request=request,
                    args=args,
                    kwargs=kwargs,
                    raw_key=raw_key,
                    endpoint=endpoint,
                    request_fingerprint=request_fingerprint,
                    actor=actor,
                    management_actor_id=management_actor_id,
                    lock_scope=lock_scope,
                    resource_type=resource_type,
                    resource_id_path=resource_id_path,
                )

            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                        [f"idempotency:{lock_scope}"],
                    )

                row = (
                    IdempotencyKey.objects.select_for_update()
                    .filter(
                        actor=actor,
                        management_actor_id=management_actor_id,
                        endpoint=endpoint,
                        key=raw_key,
                    )
                    .first()
                )
                if row is not None and row.is_expired:
                    row.delete()
                    row = None

                if row is not None:
                    if row.request_fingerprint != request_fingerprint:
                        raise IdempotencyConflict()
                    if row.status == IdempotencyStatus.COMPLETED:
                        return _replay(row)
                    if row.status == IdempotencyStatus.IN_FLIGHT:
                        # This implementation never commits IN_FLIGHT. Seeing it
                        # means a legacy/manual claimant owns the request.
                        raise IdempotencyInProgress()
                    row.status = IdempotencyStatus.IN_FLIGHT
                    row.response_status = None
                    row.response_body = None
                    row.resource_type = ""
                    row.resource_id = ""
                    row.expires_at = timezone.now() + _ttl()
                    row.save()
                else:
                    row = IdempotencyKey.objects.create(
                        key=raw_key,
                        actor=actor,
                        management_actor_id=management_actor_id,
                        endpoint=endpoint,
                        request_fingerprint=request_fingerprint,
                        expires_at=timezone.now() + _ttl(),
                    )

                try:
                    # A savepoint keeps the claim transaction usable if a domain
                    # constraint raises IntegrityError during the mutation.
                    with transaction.atomic():
                        response = view_method(view, request, *args, **kwargs)
                        if response.status_code >= 500:
                            # An endpoint may deliberately return a 5xx rather
                            # than raise. It is still not allowed to commit a
                            # partial domain effect under a retryable claim.
                            transaction.set_rollback(True)
                except Exception as exc:  # DRF normally performs this conversion outside post().
                    response = view.get_exception_handler()(
                        exc, view.get_exception_handler_context()
                    )
                    if response is None:
                        raise

                body = _payload(response)
                row.response_status = response.status_code
                row.response_body = body
                if response.status_code >= 500:
                    row.status = IdempotencyStatus.FAILED
                else:
                    row.status = IdempotencyStatus.COMPLETED
                    row.resource_type = resource_type
                    row.resource_id = _resource_id(body, resource_id_path)
                row.save()
                response["X-Idempotency-Key"] = raw_key
                return response

        return wrapped

    return decorate


def _claim_for_external_call(
    *, raw_key, endpoint, request_fingerprint, actor, management_actor_id, lock_scope
):
    """Take the key, and commit that we have taken it.

    Returns either a replayable response — the request already finished — or the
    claim row to run under. The advisory lock is released by this transaction's
    commit, which is the point: the next thing that happens is a network call,
    and nothing may be holding a lock while it does.
    """
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                [f"idempotency:{lock_scope}"],
            )

        row = (
            IdempotencyKey.objects.select_for_update()
            .filter(
                actor=actor,
                management_actor_id=management_actor_id,
                endpoint=endpoint,
                key=raw_key,
            )
            .first()
        )
        if row is not None and row.is_expired:
            row.delete()
            row = None

        if row is not None:
            if row.request_fingerprint != request_fingerprint:
                raise IdempotencyConflict()
            if row.status == IdempotencyStatus.COMPLETED:
                return _replay(row), None
            if row.status == IdempotencyStatus.IN_FLIGHT and not row.lease_expired:
                # Either a concurrent duplicate, or a claim from the
                # transactional mode, which never commits `in_flight` and so has
                # no lease. Neither may be taken over.
                raise IdempotencyInProgress()
            # A failed attempt, or one whose request died. Re-running is safe
            # because this mode is only used where the service resumes.
            row.status = IdempotencyStatus.IN_FLIGHT
            row.in_flight_until = timezone.now() + _lease()
            row.response_status = None
            row.response_body = None
            row.resource_type = ""
            row.resource_id = ""
            row.expires_at = timezone.now() + _ttl()
            row.save()
        else:
            row = IdempotencyKey.objects.create(
                key=raw_key,
                actor=actor,
                management_actor_id=management_actor_id,
                endpoint=endpoint,
                request_fingerprint=request_fingerprint,
                status=IdempotencyStatus.IN_FLIGHT,
                in_flight_until=timezone.now() + _lease(),
                expires_at=timezone.now() + _ttl(),
            )
        return None, row


def _run_with_external_calls(
    *,
    view,
    view_method,
    request,
    args,
    kwargs,
    raw_key,
    endpoint,
    request_fingerprint,
    actor,
    management_actor_id,
    lock_scope,
    resource_type,
    resource_id_path,
):
    replay, row = _claim_for_external_call(
        raw_key=raw_key,
        endpoint=endpoint,
        request_fingerprint=request_fingerprint,
        actor=actor,
        management_actor_id=management_actor_id,
        lock_scope=lock_scope,
    )
    if replay is not None:
        return replay

    # No transaction, no lock, no held connection. The view may take as long as
    # the provider does.
    try:
        response = view_method(view, request, *args, **kwargs)
    except Exception as exc:  # DRF normally converts outside post().
        response = view.get_exception_handler()(exc, view.get_exception_handler_context())
        if response is None:
            _release_claim(row)
            raise

    body = _payload(response)
    with transaction.atomic():
        current = IdempotencyKey.objects.select_for_update().filter(id=row.id).first()
        if current is None:
            # Purged mid-flight. The domain effect stands and is still
            # reachable; only the replay cache is gone.
            return response
        current.response_status = response.status_code
        current.response_body = body
        current.in_flight_until = None
        if response.status_code >= 500:
            # Not rolled back — the view has already committed its own work and
            # may have reached a provider. Recorded as retryable instead, and
            # the retry lands on the service's resume path.
            current.status = IdempotencyStatus.FAILED
        else:
            current.status = IdempotencyStatus.COMPLETED
            current.resource_type = resource_type
            current.resource_id = _resource_id(body, resource_id_path)
        current.save()

    response["X-Idempotency-Key"] = raw_key
    return response


def _release_claim(row) -> None:
    """Let go of a claim whose request produced no response at all.

    Only reached when DRF declines to convert an exception, which is a bug
    rather than a domain outcome. Leaving the claim held would make the key
    unusable until its lease ran out.
    """
    IdempotencyKey.objects.filter(id=row.id).update(
        status=IdempotencyStatus.FAILED,
        in_flight_until=None,
        updated_at=timezone.now(),
    )
