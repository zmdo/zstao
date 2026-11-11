#!/bin/sh
# Explicit integration test; never runs as part of the normal unit test command.
set -eu
test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$test_dir/../../.." && pwd)
runner=ces-openresty-smoke-runner
docker run -d --name "$runner" --network host --entrypoint sh \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v /var/lib/ces-openresty-smoke:/var/lib/ces-openresty-smoke \
    docker:27-cli -c 'sleep 1800'
# Set the trap only after creating our runner; do not remove an existing name on failure.
trap 'docker rm -f "$runner" >/dev/null' EXIT HUP INT TERM
docker exec "$runner" apk add --no-cache python3
docker exec "$runner" mkdir /work
docker cp "$test_dir/../scripts/openresty.sh" "$runner:/work/openresty.sh"
docker cp "$project_dir/skills/project-delivery/templates/deploy/site.conf" "$runner:/work/site.conf"
docker cp "$test_dir/docker_smoke.py" "$runner:/work/smoke.py"
docker exec "$runner" python3 /work/smoke.py
