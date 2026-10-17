"""Getting a financial exception out of the queue and in front of a person.

An exception queue nobody is paged for is a queue nobody reads, and the rows in
this one mean somebody's rent is in question. The application already said so in
its logs; this is the part that leaves the process.

**What this is, and is not.** It is one outbound POST to a URL an operator
configures — Slack, PagerDuty, Opsgenie and every log platform accept an
incoming webhook, so this binds to whatever the deployment actually uses without
Danpa HQ choosing a vendor. It is not a replacement for the structured log line,
which stays as the record, and it is not a replacement for external liveness
monitoring: this runs *on* the Celery worker, so a worker that is down cannot
tell anyone it is down. That gap is named in the deployment guide.

**Three rules the payload obeys.**

*It carries no tenant.* Not a name, not a phone number, not an amount, not a
provider payload. An alert stream is copied into chat channels, retained by
third parties and read by people who have no business seeing a tenant's rent.
The exception id is enough to find everything else behind an authenticated,
audited workspace, which is where that detail belongs.

*It names an owner.* An alert that arrives addressed to nobody is an alert
everybody assumes somebody else has. `PAYMENT_ALERT_OWNER` is stated in the
payload so the message says whose it is.

*It never breaks the sweep.* Delivery is best-effort with a short timeout. The
queue is the source of truth; an unreachable alerting endpoint must not stop
reconciliation from finding the next problem.
"""

from __future__ import annotations

import logging

import requests
from django.conf import settings

logger = logging.getLogger("payments.alerts")

#: Short on purpose. This runs inside the scheduled alerting task, and an
#: alerting endpoint having a bad day must not hold that task open.
DEFAULT_TIMEOUT_SECONDS = 5


def alert_owner() -> str:
    return str(getattr(settings, "PAYMENT_ALERT_OWNER", "")).strip() or "unassigned"


def _endpoint() -> str:
    return str(getattr(settings, "PAYMENT_ALERT_WEBHOOK_URL", "")).strip()


def build_payload(
    *,
    event: str,
    severity: str,
    exception_id: str,
    kind: str,
    provider: str,
    status: str,
    age_hours: int,
) -> dict:
    """The whole message. Everything in it is safe to read in a chat channel.

    Deliberately built by one function rather than assembled at each call site,
    so a future caller cannot casually add an amount or a tenant to "make the
    alert more useful". A test asserts the shape.
    """
    return {
        "event": event,
        "severity": severity,
        "service": "danpahq-payments",
        "owner": alert_owner(),
        "exception_id": exception_id,
        "kind": kind,
        "provider": provider,
        "status": status,
        "age_hours": age_hours,
        "workspace": "/management/payments/",
        "runbook": "docs/runbook.md#payment-reconciliation-who-is-on-call-and-for-what",
    }


def deliver(payload: dict) -> bool:
    """Send one alert. Returns whether it left the process.

    A `False` here is itself worth seeing, so it is logged at `error` — an
    alerting path that has quietly stopped working is the failure that hides
    every other failure.
    """
    endpoint = _endpoint()
    if not endpoint:
        # Not configured. Said once per alert at debug rather than warned about
        # every thirty minutes, because a deployment that has deliberately not
        # bound alerting yet should not drown its own logs saying so.
        logger.debug(
            "payment alert not delivered: no endpoint configured",
            extra={"event": "payment_alert_unconfigured", "kind": payload.get("kind", "")},
        )
        return False

    timeout = int(getattr(settings, "PAYMENT_ALERT_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS))
    try:
        response = requests.post(endpoint, json=payload, timeout=timeout)
    except requests.RequestException as exc:
        logger.error(
            "payment alert could not be delivered",
            extra={
                "event": "payment_alert_delivery_failed",
                "kind": payload.get("kind", ""),
                "reference": payload.get("exception_id", ""),
                "detail": str(exc)[:200],
            },
        )
        return False

    if response.status_code >= 400:
        logger.error(
            "payment alert was rejected by the alerting endpoint",
            extra={
                "event": "payment_alert_delivery_failed",
                "kind": payload.get("kind", ""),
                "reference": payload.get("exception_id", ""),
                "status_code": response.status_code,
            },
        )
        return False
    return True
