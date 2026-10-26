"""Run the canonical Property-to-tenancy lifecycle smoke test.

The old script mutated the development database through contracts that predated
Organizations and verification gates. The canonical journey now runs in an
isolated test database and fails at the first broken lifecycle boundary.

Run from the repository root while the Docker stack is up:

    python ops/smoke_phases.py
"""

from __future__ import annotations

import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGET = "tests/integration/test_core_lifecycle_smoke.py::test_provider_to_tenant_core_lifecycle"


def main() -> int:
    command = [
        "docker",
        "compose",
        "exec",
        "-T",
        "api",
        "pytest",
        TARGET,
        "-q",
        "--maxfail=1",
    ]
    try:
        # Fixed executable and arguments owned by this repository; no user
        # input is interpolated into the subprocess invocation.
        return subprocess.run(command, cwd=ROOT, check=False).returncode
    except FileNotFoundError:
        return 127


if __name__ == "__main__":
    raise SystemExit(main())
