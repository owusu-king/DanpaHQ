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
        "RESEND_API_KEY",
    )
}

PROBE = (
    "import json, config.settings.production as s; "
    "print(json.dumps({'hosts': s.ALLOWED_HOSTS, 'csrf': s.CSRF_TRUSTED_ORIGINS, "
    "'exempt': s.SECURE_REDIRECT_EXEMPT, 'redirect': s.SECURE_SSL_REDIRECT, "
    "'scan': s.FILE_SCAN_MODE, 'environment': s.ENVIRONMENT}))"
)


def production_env(**extra: str) -> dict[str, str]:
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in {"ALLOWED_HOSTS", "CSRF_TRUSTED_ORIGINS", "RENDER_EXTERNAL_HOSTNAME"}
    }
    env.update(SECRETS)
    env["DJANGO_SECRET_KEY"] = "test-only-4ab7e962-f31c-45d0-b870-9e2a50c41d7f-6a7c52fdb903"
    env["CORS_ALLOWED_ORIGINS"] = "https://danpahq.netlify.app"
    # Keep the probe independent of docker-compose's development overrides.
    env["FILE_SCAN_MODE"] = "strict"
    env["EMAIL_BACKEND"] = "apps.identity.email_backend.ResendEmailBackend"
    env.update(extra)
    return env


def load(**extra: str) -> subprocess.CompletedProcess:
    # Our own interpreter running a fixed probe; nothing here is untrusted input.
    return subprocess.run(  # noqa: S603
        [sys.executable, "-c", PROBE],
        cwd=BACKEND,
        env=production_env(**extra),
        capture_output=True,
        text=True,
    )


def test_render_names_the_host_so_it_need_not_be_repeated():
    result = load(RENDER_EXTERNAL_HOSTNAME="danpahq-api.onrender.com")
    assert result.returncode == 0, result.stderr
    settings = json.loads(result.stdout)
    assert settings["hosts"] == ["danpahq-api.onrender.com"]
    assert settings["csrf"] == ["https://danpahq-api.onrender.com"]
    assert settings["environment"] == "production"


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


def test_production_rejects_unscanned_upload_bypass():
    result = load(RENDER_EXTERNAL_HOSTNAME="danpahq-api.onrender.com", FILE_SCAN_MODE="permissive")
    assert result.returncode != 0
    assert "permissive is unsafe" in result.stderr


def test_cloudmersive_requires_a_key():
    result = load(
        RENDER_EXTERNAL_HOSTNAME="danpahq-api.onrender.com", FILE_SCAN_MODE="cloudmersive"
    )
    assert result.returncode != 0
    assert "CLOUDMERSIVE_API_KEY" in result.stderr


def test_resend_requires_a_key():
    result = load(RENDER_EXTERNAL_HOSTNAME="danpahq-api.onrender.com", RESEND_API_KEY="")
    assert result.returncode != 0
    assert "RESEND_API_KEY" in result.stderr


def test_production_rejects_console_email():
    result = load(
        RENDER_EXTERNAL_HOSTNAME="danpahq-api.onrender.com",
        EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend",
    )
    assert result.returncode != 0
    assert "real delivery backend" in result.stderr


def test_django_deployment_checks_pass_with_complete_production_settings():
    result = subprocess.run(  # noqa: S603
        [sys.executable, "manage.py", "check", "--deploy", "--settings=config.settings.production"],
        cwd=BACKEND,
        env=production_env(RENDER_EXTERNAL_HOSTNAME="danpahq-api.onrender.com"),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "System check identified no issues" in result.stdout + result.stderr
