#!/bin/sh
# Production CES runtime wrapper. Runs as root on C via the cesdeploy sudo entry.
set -eu

ROOT=/srv/ces-prod
RUNTIME=$ROOT/runtime
RELEASES=$RUNTIME/releases
STATE=$RUNTIME/current.json
ENV_FILE=$ROOT/prod.env
NETWORK=ces-prod_default
export DOCKER_CONFIG=${DOCKER_CONFIG:-$ROOT/docker-config}

usage() {
  echo "usage: ces-runtime install --digest <ref> | verify | rollback --release <id> | backup | restore --file <path>" >&2
  exit 2
}

http_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/ || true
}

wait_ready() {
  i=0
  while [ "$i" -lt 60 ]; do
    code=$(http_code)
    case "$code" in 200|303) return 0 ;; esac
    i=$((i + 1))
    sleep 2
  done
  return 1
}

container_image() {
  docker inspect -f '{{.Config.Image}}' prod-ces 2>/dev/null || true
}

record_release() {
  id=$1
  image=$2
  mkdir -p "$RELEASES"
  printf '{"id":"%s","image":"%s","recorded_at":"%s"}\n' "$id" "$image" "$(date -u +%FT%TZ)" > "$RELEASES/$id.json"
}

start_image() {
  image=$1
  docker pull "$image" >/dev/null
  docker rm -f prod-ces >/dev/null 2>&1 || true
  docker run -d --name prod-ces --network "$NETWORK" --restart unless-stopped \
    --env-file "$ENV_FILE" "$image" >/dev/null
  wait_ready
}

install() {
  image=$1
  mkdir -p "$RUNTIME" "$RELEASES"
  exec 9>"$RUNTIME/deploy.lock"
  flock -n 9 || { echo "another deployment is running" >&2; exit 1; }
  previous=$(container_image)
  id=$(printf '%s' "$image" | sed 's#[^A-Za-z0-9_.-]#-#g')
  record_release "$id" "$image"
  if start_image "$image"; then
    printf '{"image":"%s","previous":"%s","release":"%s","updated_at":"%s"}\n' \
      "$image" "$previous" "$id" "$(date -u +%FT%TZ)" > "$STATE"
    echo "deployed $image"
    return 0
  fi
  docker logs --tail 60 prod-ces >&2 || true
  if [ -n "$previous" ]; then
    echo "deployment failed; restoring $previous" >&2
    start_image "$previous" || true
  fi
  return 1
}

rollback() {
  id=$1
  file=$RELEASES/$id.json
  [ -f "$file" ] || { echo "unknown release: $id" >&2; exit 1; }
  image=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["image"])' "$file")
  install "$image"
}

backup() {
  mkdir -p "$ROOT/backups"
  file="$ROOT/backups/ces-$(date -u +%Y%m%dT%H%M%SZ).sql"
  docker exec ces-prod-postgres-prod-1 pg_dump -U ces --clean --if-exists ces > "$file"
  chmod 600 "$file"
  echo "$file"
}

restore() {
  file=$1
  [ -f "$file" ] || { echo "backup not found: $file" >&2; exit 1; }
  docker stop prod-ces >/dev/null 2>&1 || true
  docker exec -i ces-prod-postgres-prod-1 psql -U ces -d ces < "$file" >/dev/null
  docker start prod-ces >/dev/null
  wait_ready || { echo "prod-ces did not recover after restore" >&2; exit 1; }
  echo "restored $file"
}

verify() {
  docker inspect -f '{{.State.Status}}' prod-ces 2>/dev/null | grep -qx running || {
    echo "prod-ces is not running" >&2
    exit 1
  }
  code=$(http_code)
  case "$code" in 200|303) echo "prod-ces is serving HTTP $code" ;; *) echo "prod-ces HTTP $code" >&2; exit 1 ;; esac
}

[ $# -ge 1 ] || usage
case "$1" in
  install)
    [ $# -eq 3 ] && [ "$2" = "--digest" ] || usage
    install "$3"
    ;;
  rollback)
    [ $# -eq 3 ] && [ "$2" = "--release" ] || usage
    rollback "$3"
    ;;
  verify)
    verify
    ;;
  backup)
    backup
    ;;
  restore)
    [ $# -eq 3 ] && [ "$2" = "--file" ] || usage
    restore "$3"
    ;;
  *) usage ;;
esac
