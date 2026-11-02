#!/bin/sh
set -eu

BASE=/srv/onedev-verify
PASSWORD_FILE="$BASE/secrets/onedev-admin-password"
TOKEN_FILE="$BASE/secrets/onedev-agent-token"
ENV_FILE="$BASE/.env"
COMPOSE="$BASE/docker-compose.yml"

cleanup() {
  if [ "${KEEP:-0}" = "1" ]; then return; fi
  if [ -f "$COMPOSE" ]; then docker compose -f "$COMPOSE" --env-file "$ENV_FILE" down -v >/dev/null 2>&1 || true; fi
  rm -rf "$BASE"
}
trap cleanup EXIT

mkdir -p "$BASE/secrets" "$BASE/onedev" "$BASE/postgres" "$BASE/agent/work"
chmod 700 "$BASE" "$BASE/secrets"
if [ ! -f "$PASSWORD_FILE" ]; then
  openssl rand -hex 24 > "$PASSWORD_FILE"
  chmod 600 "$PASSWORD_FILE"
fi
ADMIN_PASSWORD=$(cat "$PASSWORD_FILE")

cat > "$COMPOSE" <<YAML
name: onedev-verify
services:
  postgres:
    image: postgres:16.15
    restart: unless-stopped
    environment:
      POSTGRES_DB: onedev
      POSTGRES_USER: onedev
      POSTGRES_PASSWORD: \${ONEDEV_DB_PASSWORD}
    volumes:
      - ./postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U onedev -d onedev"]
      interval: 5s
      timeout: 5s
      retries: 30
  onedev:
    image: 1dev/server:16.9.7
    restart: unless-stopped
    hostname: onedev
    environment:
      hibernate_dialect: io.onedev.server.persistence.PostgreSQLDialect
      hibernate_connection_driver_class: org.postgresql.Driver
      hibernate_connection_url: jdbc:postgresql://postgres:5432/onedev
      hibernate_connection_username: onedev
      hibernate_connection_password: \${ONEDEV_DB_PASSWORD}
      initial_user: admin
      initial_password_file: /run/secrets/onedev-admin-password
      initial_email: admin@example.com
      initial_server_url: http://onedev:6610
    secrets:
      - onedev-admin-password
    volumes:
      - ./onedev:/opt/onedev
    ports:
      - 127.0.0.1:6610:6610
    depends_on:
      postgres:
        condition: service_healthy
  agent:
    image: 1dev/agent
    restart: unless-stopped
    hostname: myagent
    environment:
      serverUrl: http://onedev:6610
      agentToken: \${ONEDEV_AGENT_TOKEN}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./agent/work:/agent/work
    depends_on:
      - onedev
secrets:
  onedev-admin-password:
    file: ./secrets/onedev-admin-password
YAML

cat > "$ENV_FILE" <<ENV
ONEDEV_DB_PASSWORD=$(openssl rand -hex 16)
ONEDEV_AGENT_TOKEN=unset
ENV
chmod 600 "$ENV_FILE"

echo "== starting postgres/onedev =="
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" up -d postgres onedev

ready=0
for i in $(seq 1 90); do
  if curl -fsS --max-time 3 http://127.0.0.1:6610/~api/server/ready 2>/dev/null | grep -qx 'true'; then ready=1; break; fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo "OneDev did not become ready"
  docker compose -f "$COMPOSE" --env-file "$ENV_FILE" logs --tail=80 onedev || true
  exit 1
fi
echo "OneDev ready"

for i in $(seq 1 30); do
  ID=$(curl -fsS -u "admin:$ADMIN_PASSWORD" -X POST http://127.0.0.1:6610/~api/agent-tokens 2>/dev/null || true)
  [ -n "$ID" ] && break
  sleep 2
done
if [ -z "${ID:-}" ]; then
  echo "agent token creation failed"
  exit 1
fi
echo "token id=$ID"
TOKEN=$(curl -fsS -u "admin:$ADMIN_PASSWORD" "http://127.0.0.1:6610/~api/agent-tokens/$ID" | python3 -c 'import json,sys; print(json.load(sys.stdin)["value"])')
[ -n "$TOKEN" ]
printf '%s\n' "$TOKEN" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"
sed -i "s/^ONEDEV_AGENT_TOKEN=.*/ONEDEV_AGENT_TOKEN=$TOKEN/" "$ENV_FILE"

echo "== starting agent =="
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" up -d agent
online=0
for i in $(seq 1 60); do
  if curl -fsS -u "admin:$ADMIN_PASSWORD" "http://127.0.0.1:6610/~api/agent-tokens/$ID/agent" 2>/dev/null | grep -q '"online":true'; then online=1; break; fi
  sleep 2
done
if [ "$online" -ne 1 ]; then
  echo "agent did not become online"
  docker compose -f "$COMPOSE" --env-file "$ENV_FILE" logs --tail=80 agent || true
  exit 1
fi
echo "agent online"
echo "== success =="
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" ps
