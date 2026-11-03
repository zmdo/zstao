#!/bin/sh
set -eu

# The profile's node_modules are baked into the image. The rest of DSH_HOME is
# a host volume, so keep the profile aligned with the image on every start.
mkdir -p /dsh-home/profiles/web/node_modules
cp -a /opt/dsh-profile/package.json /opt/dsh-profile/cordis.yml /dsh-home/profiles/web/
cp -a /opt/dsh-profile/node_modules/. /dsh-home/profiles/web/node_modules/

# npm writes relative file: links. They are valid under /opt/dsh-profile but
# break after the profile moves under /dsh-home, so point @smp at /app/plugins.
for link in /dsh-home/profiles/web/node_modules/@smp/*; do
  [ -L "$link" ] || continue
  target=$(readlink "$link")
  plugin=${target##*/}
  rm -f "$link"
  ln -s "/app/plugins/$plugin" "$link"
done

node /app/docker/render-profile.mjs

BIND_HOST="${BIND_HOST:-}"
if [ -z "$BIND_HOST" ] || [ "$BIND_HOST" = "0.0.0.0" ]; then
  BIND_HOST=$(hostname -I | awk '{print $1}')
fi
set -- web --no-open --host "$BIND_HOST" --port "${PORT:-9090}"
if [ -n "${TRUSTED_HOST:-}" ]; then
  set -- "$@" --trusted-host "$TRUSTED_HOST"
fi
exec dsh "$@"
