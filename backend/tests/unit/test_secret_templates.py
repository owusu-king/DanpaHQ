"""Release examples must never become containers for real deployment credentials."""

import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("name", ["staging-owner.env.example", "production-owner.env.example"])
def test_owner_examples_have_no_filled_secrets(name):
    for number, line in enumerate((BACKEND / name).read_text().splitlines(), 1):
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        key, value = line.split("=", 1)
        if re.search(r"PASSWORD|SECRET|PEPPER|TOKEN|(?:^|_)KEY(?:_|$)", key) and value.strip():
            # Do not use a value assertion: pytest could print a real secret on failure.
            pytest.fail(f"{name}:{number}: {key} must be blank; use an ignored owner-env file.")


def test_owner_examples_and_named_environment_files_are_excluded_from_docker():
    patterns = (BACKEND / ".dockerignore").read_text().splitlines()
    for name in ["staging-owner.env.example", "production-owner.env.example", "*.env", "*.env.*"]:
        assert name in patterns
