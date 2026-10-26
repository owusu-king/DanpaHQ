"""One service: stop the whole process group if any essential child exits."""

import os
import signal
import subprocess
import sys
import threading
import time
from contextlib import suppress


def commands():
    return [
        [sys.executable, "-m", "celery", "-A", "config", "worker",
         "-Q", "default,payments,notifications,media", "--concurrency=1", "-l", "info"],
        [sys.executable, "manage.py", "run_scheduler"],
        [sys.executable, "-m", "gunicorn", "config.wsgi:application",
         "--bind", f"0.0.0.0:{os.environ.get('PORT', '8000')}",
         "--workers", "1", "--threads", "4", "--timeout", "60", "--access-logfile", "-"],
    ]


def signal_group(child, sig):
    with suppress(ProcessLookupError):
        os.killpg(child.pid, sig)


def shutdown(children, grace=75):
    # Separate sessions include worker pool children and the scheduler's beat.
    # Signal all first, then wait against one deadline, not one per child.
    for child in children:
        signal_group(child, signal.SIGTERM)
    deadline = time.monotonic() + grace
    for child in children:
        with suppress(subprocess.TimeoutExpired):
            child.wait(timeout=max(0, deadline - time.monotonic()))
    # Also kill surviving descendants whose immediate parent already exited.
    for child in children:
        signal_group(child, signal.SIGKILL)
        child.wait()


def main():
    stopped = threading.Event()
    previous = {}
    for sig in (signal.SIGTERM, signal.SIGINT):
        previous[sig] = signal.signal(sig, lambda *_: stopped.set())
    children = []
    try:
        for command in commands():
            if stopped.is_set():
                return 0
            children.append(subprocess.Popen(command, start_new_session=True))  # noqa: S603
        while not stopped.wait(0.25):
            if any(child.poll() is not None for child in children):
                sys.stderr.write("An essential process exited; stopping service for restart.\n")
                return 1
        return 0
    finally:
        shutdown(children)
        for sig, handler in previous.items():
            signal.signal(sig, handler)


if __name__ == "__main__":
    sys.exit(main())
