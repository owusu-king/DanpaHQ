"""Notification housekeeping."""

from __future__ import annotations

from celery import shared_task


@shared_task(name="notifications.age_out_stale")
def age_out_stale() -> dict[str, int]:
    """Mark everyone's weeks-old unread notifications read, then prune them.

    The list endpoint does this for one person as they read; the sweep keeps the
    badge honest for people who have not opened Updates in a while.
    """
    from .services import age_out

    return {"aged_out": age_out()}
