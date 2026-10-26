#!/bin/sh
# Runtime only: migrations and owner credentials belong to render-migrate.sh.
set -eu
: "${DJANGO_SETTINGS_MODULE:=config.settings.production}"
export DJANGO_SETTINGS_MODULE
case "$DJANGO_SETTINGS_MODULE" in
  config.settings.production|config.settings.staging) ;;
  *) echo "Render commands require production or staging settings." >&2; exit 1 ;;
esac

# An owner secret must never enter the application/worker process.
if [ -n "${DATABASE_RUNTIME_PASSWORD:-}" ] || [ -n "${DJANGO_SUPERUSER_PASSWORD:-}" ] || \
   [ -n "${DJANGO_SUPERUSER_PHONE:-}" ] || [ -n "${DJANGO_SUPERUSER_EMAIL:-}" ]; then
  echo "Remove migration/bootstrap secrets from the runtime environment." >&2
  exit 1
fi
python manage.py check --deploy --fail-level WARNING
python manage.py check_runtime_database
case "${1:-all}" in
  all)
    python manage.py collectstatic --noinput
    exec python scripts/render-supervise.py
    ;;
  api)
    python manage.py collectstatic --noinput
    exec gunicorn config.wsgi:application --bind "0.0.0.0:${PORT:-8000}" \
      --workers 1 --threads 4 --timeout 60 --access-logfile -
    ;;
  worker)
    exec celery -A config worker -Q default,payments,notifications,media \
      --concurrency=2 -l info
    ;;
  beat)
    exec python manage.py run_scheduler
    ;;
  *) echo "Expected all, api, worker or beat." >&2; exit 1 ;;
esac
