#!/bin/sh
# One-off release command using an owner-only environment; never run by services.
set -eu
: "${DJANGO_SETTINGS_MODULE:=config.settings.production}"
export DJANGO_SETTINGS_MODULE
case "$DJANGO_SETTINGS_MODULE" in
  config.settings.production|config.settings.staging) ;;
  *) echo "Render commands require production or staging settings." >&2; exit 1 ;;
esac
python manage.py check --deploy --fail-level WARNING
python manage.py migrate --noinput
python manage.py provision_runtime_database
python manage.py seed_geo
python manage.py seed_amenities
python manage.py bootstrap_superuser
