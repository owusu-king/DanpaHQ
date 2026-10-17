"""Production settings on Render (render.yaml).

Loaded in a fresh interpreter, because the module reads the environment once at
import and the test process already runs on the test settings.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]

SECRETS = {
    key: f"test-{key.lower()}"
    for key in (
        "DJANGO_SECRET_KEY",
        "OTP_PEPPER",
        "ACCESS_TOKEN_KEY",
        "NATIONAL_ID_PEPPER",
        "UNIT_ACCESS_CODE_PEPPER",
        "MANAGEMENT_CSRF_KEY",
        "RUNTIME_CONFIG_ENCRYPTION_KEY",
        "STORAGE_SIGNING_KEY",
    )
}

PROBE = (
    "import json, config.settings.production as s; "
    "print(json.dumps({'hosts': s.ALLOWED_HOSTS, 'csrf': s.CSRF_TRUSTED_ORIGINS, "
    "'exempt': s.SECURE_REDIRECT_EXEMPT, 'redirect': s.SECURE_SSL_REDIRECT}))"
)


def load(**extra: str) -> subprocess.CompletedProcess:
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in {"ALLOWED_HOSTS", "CSRF_TRUSTED_ORIGINS", "RENDER_EXTERNAL_HOSTNAME"}
    }
    env.update(SECRETS)
    env["CORS_ALLOWED_ORIGINS"] = "https://danpahq.netlify.app"
    env.update(extra)
    # Our own interpreter running a fixed probe; nothing here is untrusted input.
    return subprocess.run(  # noqa: S603
        [sys.executable, "-c", PROBE], cwd=BACKEND, env=env, capture_output=True, text=True
    )


def test_render_names_the_host_so_it_need_not_be_repeated():
    result = load(RENDER_EXTERNAL_HOSTNAME="danpahq-api.onrender.com")
    assert result.returncode == 0, result.stderr
    settings = json.loads(result.stdout)
    assert settings["hosts"] == ["danpahq-api.onrender.com"]
    assert settings["csrf"] == ["https://danpahq-api.onrender.com"]


def test_a_custom_domain_is_kept_beside_the_render_host():
    result = load(
        RENDER_EXTERNAL_HOSTNAME="danpahq-api.onrender.com",
        ALLOWED_HOSTS="api.danpahq.com",
        CSRF_TRUSTED_ORIGINS="https://api.danpahq.com",
    )
    settings = json.loads(result.stdout)
    assert settings["hosts"] == ["api.danpahq.com", "danpahq-api.onrender.com"]
    assert settings["csrf"] == ["https://api.danpahq.com", "https://danpahq-api.onrender.com"]


@pytest.mark.parametrize("missing", ["hosts", "csrf"])
def test_no_known_host_stops_the_deploy(missing):
    extra = {"ALLOWED_HOSTS": "api.danpahq.com", "CSRF_TRUSTED_ORIGINS": "https://api.danpahq.com"}
    extra.pop("ALLOWED_HOSTS" if missing == "hosts" else "CSRF_TRUSTED_ORIGINS")
    result = load(**extra)
    assert result.returncode != 0
    assert "ImproperlyConfigured" in result.stderr


def test_only_the_health_check_skips_the_https_redirect():
    # Render probes over plain HTTP; a 4xx there would cancel the deploy.
    result = load(RENDER_EXTERNAL_HOSTNAME="danpahq-api.onrender.com")
    settings = json.loads(result.stdout)
    assert settings["redirect"] is True
    assert settings["exempt"] == [r"^healthz$", r"^api/v1/healthz/$"]
