# Setup notes and troubleshooting

Everything runs in Docker (`docker compose up`), so the setup is the same on
Windows, macOS and Linux. This page covers the problems that do come up, most
of them on Windows.

## Prerequisites

1. **Docker Desktop** — https://docs.docker.com/get-started/get-docker/
   On Windows, enable the WSL 2 backend. Verify with `docker compose version`.
2. **Node.js 22 LTS** — only if you want to run the Expo mobile app, which
   cannot run in a container.
3. **Git line endings**, on Windows. The repository ships a `.gitattributes`
   that keeps shell scripts and SQL as LF. Clone with:
   ```
   git config --global core.autocrlf false
   ```

You do not need Python, PostgreSQL or Redis installed on the host.

## Troubleshooting

### `docker compose up` says the .env file is missing

Copy it first: `copy .env.example .env` (CMD, PowerShell) or
`cp .env.example .env` (bash). The defaults in it work as they are.

### Port 5432, 6379, 3000, 8000 or 9000 already in use

Something on the host already holds the port — most often a locally installed
PostgreSQL service. Either stop it (`net stop postgresql-x64-16` on Windows) or
change the host side of the mapping in `docker-compose.yml`, for example
`"5433:5432"`. The port inside the network is unchanged, so nothing else needs
editing.

### The API container exits immediately

Read the reason: `docker compose logs api`. The usual causes are a database
that is not up yet (the healthcheck should prevent it), or a migration that
fails. `docker compose down -v && docker compose up` gives a clean database.

### Changes to the code are not picked up

The source directories are bind-mounted, so a save should reload. If the
reloader misses changes on Windows, restart the one service:
`docker compose restart api`. Dependency changes need a rebuild:
`docker compose build api`.

The web container runs Next's Webpack development compiler because its
Watchpack polling mode reliably observes Windows bind-mount changes. If a tab
predates a compiler restart, refresh it once; later source saves should reload
without restarting the container.

### "Cannot find module" in the web container

`node_modules` lives in the Docker-managed `web_node_modules` volume, not on
the host. Rebuild the image and let the entrypoint refresh that volume:

```bash
docker compose up --build web
```

The web service does not run `npm install` on every ordinary start. If startup
fails, it remains stopped so `docker compose logs web` preserves the actionable
error instead of repeatedly running the dependency installation in a restart
loop.

### The MinIO bucket does not exist

```bash
docker compose exec api python manage.py ensure_bucket
```

### I never receive an OTP code

No SMS provider is integrated. `SMS_BACKEND=console` prints codes to the API
log: `docker compose logs -f api`.

## Running the backend without Docker

Supported, if you already have PostgreSQL and Redis:

```bash
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt   # POSIX: .venv/bin/pip
```

Change `POSTGRES_HOST`, `REDIS_URL` and `S3_ENDPOINT_URL` in `.env` from the
service names to `localhost`, then run `python manage.py migrate` and
`python manage.py runserver`.

Two Windows-specific notes if you do this:

- **Celery needs `--pool=solo`.** The default prefork pool depends on `fork()`,
  which Windows does not have. Without it the worker starts and silently
  processes nothing.
- **`tzdata` is required**, or `TIME_ZONE = "Africa/Accra"` raises
  `ZoneInfoNotFoundError` at startup. It is in `requirements.txt` already.

If you would rather not run MinIO, set `STORAGE_BACKEND=local` in `.env`. The
API then stores uploads in `backend/media/` and signs its own download URLs; the
presigned-URL contract is identical, so the application behaves the same way.

## Platform limitations recorded, not hidden

1. **No SMS provider is integrated.** `SMS_BACKEND=console` prints OTP codes to
   the API log. That is how you read codes during development.
2. **SIM-swap data is not available.** The 72-hour hold is enforced, but it can
   only trigger on a phone-number change you make yourself in the app, not on a
   carrier-reported SIM swap.
3. **Identity verification requires a file upload.** Until a file is attached as
   evidence, a verification stays in `pending`. The upload flow is complete, but
   there is no document scanning — `FILE_SCAN_MODE=permissive` releases files
   without a real scanner.
4. **Account recovery is not built.** Losing your phone number means losing
   access. This is recorded as a known limitation, not a planned feature for a
   later phase.
