# Multi-stage: the runtime image carries no build toolchain and no source of
# credentials, and runs as a non-root user.
#
# Build args:
#   INSTALL_DEV=true  also installs requirements-dev.txt (pytest, ruff, mypy).
#                     docker-compose.yml sets this; production builds do not.

FROM python:3.12-slim-bookworm AS builder

ARG INSTALL_DEV=false
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential libpq-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY requirements.txt requirements-dev.txt ./
RUN pip install --prefix=/install -r requirements.txt \
 && if [ "$INSTALL_DEV" = "true" ]; then \
      pip install --prefix=/install -r requirements-dev.txt; \
    fi

FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/usr/local/bin:$PATH"

# gdal-bin brings the GDAL, GEOS and PROJ shared libraries GeoDjango loads at
# import. Map search runs on PostGIS (ADR 0033); without them the app cannot
# start, so they belong to the runtime image rather than a dev extra.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpq5 curl gdal-bin fonts-dejavu-core && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 app

COPY --from=builder /install /usr/local
WORKDIR /app
COPY --chown=app:app . /app

RUN mkdir -p /app/staticfiles \
    && chown -R app:app /app/staticfiles


USER app
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8000/healthz || exit 1

CMD ["gunicorn", "config.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "3", \
     "--timeout", "60", \
     "--access-logfile", "-"]
