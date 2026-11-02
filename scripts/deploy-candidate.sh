#!/bin/sh
# Deploy a built candidate image on the B test host. Runs as the OneDev agent user.
set -eu

image=${1:?image id or reference is required}
env_file=${2:-/srv/ces-test/candidate.env}
network=ces-test_default

docker network inspect "$network" >/dev/null 2>&1 || {
  echo "test network $network is missing; install the test server type first" >&2
  exit 1
}

docker rm -f candidate-ces >/dev/null 2>&1 || true
docker rm -f ces-candidate-ces >/dev/null 2>&1 || true
docker run -d --name candidate-ces --network "$network" --restart unless-stopped \
  --env-file "$env_file" "$image" >/dev/null

i=0
while [ "$i" -lt 60 ]; do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/ || true)
  case "$code" in
    200|303)
      echo "candidate $image is serving HTTP $code through Caddy on port 80"
      exit 0
      ;;
  esac
  i=$((i + 1))
  sleep 2
done

echo "candidate did not become ready" >&2
docker logs --tail 60 candidate-ces >&2 || true
exit 1
