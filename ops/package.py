#!/usr/bin/env python
"""Build the phase release archive.

Replaces ops/package.sh, which needed bash and the `zip` binary - neither is
present on a stock Windows machine. This uses Python's zipfile, so it runs
anywhere Python does.

Every archive contains the complete project at that point, never a diff.

    python ops/package.py 02-property 0.3.0
"""

from __future__ import annotations

import argparse
import fnmatch
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

EXCLUDE_DIRS = {
    "node_modules", "__pycache__", ".git", ".next", ".venv", "venv",
    ".expo", "staticfiles", "dist", ".pytest_cache", ".mypy_cache",
    ".ruff_cache", "htmlcov", ".turbo",
}

EXCLUDE_FILES = [
    "*.pyc", "*.pyo", "*.log", ".env", ".env.local", ".coverage",
    "*.sqlite3", ".DS_Store", "Thumbs.db",
]


def is_excluded(path: Path) -> bool:
    if any(part in EXCLUDE_DIRS for part in path.parts):
        return True
    return any(fnmatch.fnmatch(path.name, pattern) for pattern in EXCLUDE_FILES)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the phase release archive.")
    parser.add_argument("phase", nargs="?", default="02-property")
    parser.add_argument("version", nargs="?", default="0.3.0")
    args = parser.parse_args()

    name = f"danpahq-phase-{args.phase}-v{args.version}"
    out_dir = ROOT / "dist"
    out_dir.mkdir(exist_ok=True)
    archive = out_dir / f"{name}.zip"
    archive.unlink(missing_ok=True)

    count = 0
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for path in sorted(ROOT.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(ROOT)
            if is_excluded(relative) or relative.parts[0] == "dist":
                continue
            # Forward slashes in the archive regardless of host OS, so an
            # archive built on Windows extracts correctly on Linux.
            bundle.write(path, arcname=f"{name}/{relative.as_posix()}")
            count += 1

    size_mb = archive.stat().st_size / 1_048_576
    print(f"Wrote {archive} ({count} files, {size_mb:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
