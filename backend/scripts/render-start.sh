#!/bin/sh
# Start the API on Render's free plan (render.yaml runs: sh scripts/render-start.sh).
#
# The free plan has no pre-deploy step and no background workers, so this one
# container does everything, in order:
#   1. apply migrations;
#   2. seed reference data (both seeds create-or-update, so repeating is safe);
#   3. start Celery's worker with its scheduler (-B) in the background;
#   4. hand the process over to gunicorn on the port Render gives us.
#
# A script rather than an inline command because Render passes dockerCommand
# to the container without shell parsing: quotes in `sh -c "…"` arrive as
# literal characters and the whole line is looked up as one program name.

set -e

python manage.py migrate --noinput
python manage.py seed_geo
python manage.py seed_amenities

celery -A config worker -B \
  -Q default,payments,notifications,media \
  --concurrency=1 -l info \
  --schedule /tmp/celerybeat-schedule &

# One worker with threads keeps the API, Celery and the scheduler inside 512 MB.
exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT:-10000}" \
  --workers 1 --threads 4 --timeout 60 \
  --access-logfile -
