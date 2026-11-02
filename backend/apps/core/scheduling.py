"""A small-process beat retains the same fail-closed PostgreSQL session lease."""

from celery.beat import PersistentScheduler


class LeasedScheduler(PersistentScheduler):
    def __init__(self, *args, lease, stopped, **kwargs):
        self.lease = lease
        self.stopped = stopped
        super().__init__(*args, **kwargs)

    def tick(self, *args, **kwargs):
        if self.stopped.is_set():
            # Service.start catches this and closes the schedule before the lease closes.
            raise SystemExit(0)
        # Never publish after losing the session that owns the advisory lock.
        self.lease.execute("SELECT 1")
        return super().tick(*args, **kwargs)
