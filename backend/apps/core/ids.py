"""Identifier primitives.

Framework-independent on purpose: these are pure value helpers so they can be
unit-tested without Django, and reused by workers, scripts and data tooling.

Two kinds of identifier exist in this system and they are not interchangeable:

* **Surrogate keys** (``uuid7()``) — every table's primary key. Opaque, globally
  unique, never shown to users, safe to generate client-side or in a worker.
* **Reference codes** (``reference_code()``) — short human-quotable codes that a
  tenant reads out over the phone to a support agent, or a landlord types into a
  mobile-money narration field. Optimised for being spoken and typed on a phone
  keypad, not for density.
"""

from __future__ import annotations

import os
import secrets
import time
import uuid

__all__ = ["CROCKFORD_ALPHABET", "reference_code", "uuid7", "uuid7_at"]

# Crockford base32 minus I, L, O, U: removes the digit/letter confusions that
# cause support tickets when a code is read aloud or written on paper.
CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

_LAST_MS = 0
_SEQ = 0


def uuid7_at(unix_ms: int, *, rand: bytes | None = None) -> uuid.UUID:
    """Build an RFC 9562 UUIDv7 for an explicit millisecond timestamp.

    Layout: 48 bits big-endian Unix milliseconds, 4 bits version, 12 bits
    ``rand_a``, 2 bits variant, 62 bits ``rand_b``.
    """
    if not 0 <= unix_ms < 2**48:
        raise ValueError("unix_ms out of range for a 48-bit UUIDv7 timestamp")
    rand = rand or os.urandom(10)
    if len(rand) != 10:
        raise ValueError("rand must be exactly 10 bytes")

    value = unix_ms << 80
    value |= 0x7 << 76  # version 7
    value |= (int.from_bytes(rand[:2], "big") & 0x0FFF) << 64  # rand_a
    value |= 0b10 << 62  # RFC 9562 variant
    value |= int.from_bytes(rand[2:], "big") & ((1 << 62) - 1)  # rand_b
    return uuid.UUID(int=value)


def uuid7() -> uuid.UUID:
    """Time-ordered UUID for primary keys.

    Why not UUIDv4: random keys scatter B-tree inserts across the whole index,
    which on a rental platform's hottest tables (listings, ledger entries, audit
    log) costs write throughput and cache locality as the table grows. UUIDv7
    keeps inserts near the right-hand edge of the index like a bigint sequence
    would, while staying non-guessable and safe to mint outside the database.

    Within the same millisecond a monotonic counter is folded into ``rand_a`` so
    that ids minted in a tight loop still sort in creation order.
    """
    global _LAST_MS, _SEQ

    now_ms = time.time_ns() // 1_000_000
    if now_ms == _LAST_MS:
        _SEQ = (_SEQ + 1) & 0x0FFF
    else:
        _LAST_MS = now_ms
        _SEQ = secrets.randbelow(0x0800)  # leave headroom before wraparound

    rand = _SEQ.to_bytes(2, "big") + os.urandom(8)
    return uuid7_at(now_ms, rand=rand)


def reference_code(prefix: str, length: int = 8) -> str:
    """Return e.g. ``PAY-7K3M9QX2`` — a code a person can read down a phone line.

    ``prefix`` names the object class (PAY, LSE, APP, TKT) so support can route a
    code without looking it up first.
    """
    prefix = prefix.strip().upper()
    if not prefix.isalpha() or not 2 <= len(prefix) <= 4:
        raise ValueError("prefix must be 2-4 letters")
    if length < 6:
        raise ValueError("length must be at least 6 to keep collisions rare")
    body = "".join(secrets.choice(CROCKFORD_ALPHABET) for _ in range(length))
    return f"{prefix}-{body}"
