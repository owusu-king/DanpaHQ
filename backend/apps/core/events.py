"""Domain events.

Bounded contexts talk to each other through events, not by importing each
other's models. When a lease is signed, the lease context does not call the
notification context - it emits ``lease.signed.v1`` and moves on.

Events are versioned in their name (``.v1``) because a consumer deployed today
must keep working when the producer adds a field tomorrow.

Delivery is via the transactional outbox (``apps.outbox``): the event row is
written in the same database transaction as the state change, so it is
impossible to charge a tenant and lose the receipt notification, or to send a
receipt for a payment that rolled back.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class DomainEvent:
    name: str  # "lease.signed.v1"
    aggregate_type: str  # "lease"
    aggregate_id: str
    payload: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        parts = self.name.split(".")
        if len(parts) < 3 or not parts[-1].startswith("v"):
            raise ValueError("event names look like 'context.thing_happened.v1'")

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)
