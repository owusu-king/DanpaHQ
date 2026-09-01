#!/bin/sh
set -eu

stamp_file="node_modules/.rooomly-package-lock.sha256"
lock_hash="$(sha256sum package-lock.json | awk '{print $1}')"
installed_hash=""

if [ -f "$stamp_file" ]; then
    installed_hash="$(cat "$stamp_file")"
fi

if [ "$installed_hash" != "$lock_hash" ]; then
    echo "package-lock.json changed; refreshing web dependencies..."
    npm ci
    printf '%s\n' "$lock_hash" > "$stamp_file"
fi

# Compose enables Watchpack polling because Windows bind mounts do not deliver
# reliable filesystem events. Next 16 defaults to Turbopack, which bypasses
# those Watchpack settings, so use Webpack for predictable container hot reload.
exec npm run dev -- --webpack --hostname 0.0.0.0
