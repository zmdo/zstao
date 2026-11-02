#!/bin/sh
set -eu
node /app/docker/render-profile.mjs
HOST_IP="${BIND_HOST:-$(hostname -I | awk '{print $1}')}"
set -- web --no-open --host "$HOST_IP" --port 9090
if [ -n "${TRUSTED_HOST:-}" ]; then
  set -- "$@" --trusted-host "$TRUSTED_HOST"
fi
exec dsh "$@"
