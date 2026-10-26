#!/bin/sh
# One-off release command using an owner-only environment; never run by services.
set -eu
: "${DJANGO_SETTINGS_MODULE:=config.settings.production}"
export DJANGO_SETTINGS_MODULE
if [ "$DJANGO_SETTINGS_MODULE" != "config.settings.production" ]; then
  echo "Render commands require production settings." >&2
  exit 1
fi
python manage.py check --deploy --fail-level WARNING
python manage.py migrate --noinput
python manage.py provision_runtime_database
python manage.py seed_geo
python manage.py seed_amenities
python manage.py bootstrap_superuser
