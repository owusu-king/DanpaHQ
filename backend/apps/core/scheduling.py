"""A small-process beat retains the same fail-closed PostgreSQL session lease."""

from time import monotonic

from celery.beat import PersistentScheduler

LEASE_HEARTBEAT_SECONDS = 30


class LeasedScheduler(PersistentScheduler):
    def __init__(self, *args, lease, stopped, **kwargs):
        self.lease = lease
        self.stopped = stopped
        self.next_heartbeat = 0.0
        super().__init__(*args, **kwargs)

    def check_running(self):
        if self.stopped.is_set():
            # Service.start catches this and closes the schedule before the lease closes.
            raise SystemExit(0)

    def check_lease(self):
        self.lease.execute("SELECT 1")
        self.next_heartbeat = monotonic() + LEASE_HEARTBEAT_SECONDS

    def tick(self, *args, **kwargs):
        self.check_running()
        if monotonic() >= self.next_heartbeat:
            self.check_lease()
        return super().tick(*args, **kwargs)

    def apply_entry(self, entry, producer=None):
        # A fresh heartbeat is not evidence that the lease still exists.
        self.check_running()
        self.check_lease()
        return super().apply_entry(entry, producer=producer)
