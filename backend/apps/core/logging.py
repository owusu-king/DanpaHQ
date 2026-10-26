"""Structured JSON logging.

Every log line carries the request id and actor, so a support ticket that quotes
one reference code can be traced across API, worker and webhook logs. Phone
numbers and identity documents are masked at the formatter, because the safest
place to strip PII is the last one before it leaves the process.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime

from .context import get_context

_PHONE = re.compile(r"\+233\d{9}")
_LONG_DIGITS = re.compile(r"\b\d{9,}\b")


#: Structured fields a caller may attach through ``extra=``. An allowlist rather
#: than "copy everything", so a stray object never reaches the log — but a
#: deliberately short one is worse than useless: the reconciliation and provider
#: warnings passed ``detail`` and ``status``, neither of which was listed, so
#: the exact reason a settlement import or a Paystack call failed was dropped on
#: the floor and the operator got a line saying only that something went wrong.
#: String values are redacted like the message itself.
STRUCTURED_KEYS = (
    "event",
    "duration_ms",
    "status_code",
    "status",
    "path",
    "method",
    "provider",
    "detail",
    "error",
    "kind",
    "count",
    "reference",
)


def redact(text: str) -> str:
    text = _PHONE.sub(lambda m: f"{m.group()[:7]}****{m.group()[-2:]}", text)
    return _LONG_DIGITS.sub(lambda m: f"{m.group()[:3]}***{m.group()[-2:]}", text)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        ctx = get_context()
        payload = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": redact(record.getMessage()),
            "request_id": ctx.request_id or None,
            "actor_id": ctx.actor_id,
            "source": ctx.source,
        }
        for key in STRUCTURED_KEYS:
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = redact(value) if isinstance(value, str) else value
        if record.exc_info:
            payload["exception"] = redact(self.formatException(record.exc_info))
        return json.dumps(payload, ensure_ascii=False, default=str)
