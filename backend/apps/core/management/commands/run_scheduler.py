"""Hold a dedicated PostgreSQL session lock for the lifetime of Celery beat."""

import signal
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

import psycopg
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

# Scoped by PostgreSQL to this database. Session pooling is required in production.
SCHEDULER_LOCK = 0x44414E50414851


class Command(BaseCommand):
    help = "Run one active scheduler, including during overlapping Render deployments."

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument(
            "--in-process", action="store_true", default=True,
            help="Run beat in the lease-holding process (default).",
        )
        mode.add_argument(
            "--subprocess", action="store_false", dest="in_process",
            help="Use the legacy separate beat process, retaining the same lease checks.",
        )

    def handle(self, *args, **options):
        stopped = threading.Event()
        previous = {}
        for sig in (signal.SIGTERM, signal.SIGINT):
            previous[sig] = signal.signal(sig, lambda *_: stopped.set())
        try:
            # A dedicated session must never reconnect silently: losing it also
            # loses the lock, so stop beat and let the host restart this process.
            with (tempfile.TemporaryDirectory(prefix="danpahq-beat-") as state,
                  psycopg.connect(**connection.get_connection_params(), autocommit=True) as lease):
                while not stopped.is_set():
                    if acquire(lease):
                        break
                    stopped.wait(2)
                if stopped.is_set():
                    return
                if options.get("in_process", True):
                    run_inline(lease, stopped, str(Path(state) / "schedule"))
                    return
                child = subprocess.Popen(  # noqa: S603 -- fixed executable and arguments
                    [sys.executable, "-m", "celery", "-A", "config", "beat", "-l", "info",
                     "--schedule", str(Path(state) / "schedule")],
                )
                try:
                    while not stopped.wait(2):
                        lease.execute("SELECT 1")
                        if child.poll() is not None:
                            raise CommandError("Celery beat exited; restart the scheduler.")
                finally:
                    # Always stop beat before releasing its session lock.
                    stop_child(child)
        except psycopg.Error as exc:
            raise CommandError("Scheduler database lease failed; Celery beat stopped.") from exc
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)


def acquire(lease):
    return lease.execute("SELECT pg_try_advisory_lock(%s)", [SCHEDULER_LOCK]).fetchone()[0]


def run_inline(lease, stopped, schedule_filename):
    from functools import partial

    from celery.beat import Service

    from apps.core.scheduling import LeasedScheduler
    from config.celery import app

    app.loader.import_default_modules()
    Service(
        app=app, max_interval=2, schedule_filename=schedule_filename,
        scheduler_cls=partial(LeasedScheduler, lease=lease, stopped=stopped),
    ).start()


def stop_child(child):
    if child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
