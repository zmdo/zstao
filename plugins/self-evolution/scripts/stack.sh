#!/bin/sh
request=$(mktemp)
trap 'rm -f "$request"' EXIT
cat > "$request"
python3 - "$request" <<'PY'
import json, os, re, subprocess, sys, time
from pathlib import Path

request = json.load(open(sys.argv[1]))
operation = request['operation']
software = request['software']
prefix = '@smp/console-self-evolution/'
services = {
    prefix + 'postgresql': ('postgres', 'postgres:16.15', '16.15.0'),
    prefix + 'onedev': ('onedev', '1dev/server:16.9.7', '16.9.7'),
    prefix + 'caddy': ('caddy', 'caddy:2.10.2', '2.10.2'),
}
if software not in services:
    raise SystemExit('unsupported software: ' + software)
service, image, version = services[software]
base = Path('/srv/ces-infra')
runtime = base / 'runtime'
secrets = base / 'secrets'
compose = runtime / 'compose.yml'
env_file = runtime / '.env'
caddyfile = runtime / 'Caddyfile'
admin_password = secrets / 'onedev-admin-password'

def root(args, check=True):
    command = args if os.geteuid() == 0 else ['sudo', '-n'] + args
    return subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check)

def write_root(path, content):
    try:
        Path(path).write_text(content)
    except PermissionError:
        result = subprocess.run(['sudo', '-n', 'tee', str(path)], input=content, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if result.returncode:
            raise RuntimeError(result.stderr[-500:])
    try:
        os.chmod(path, 0o600)
    except PermissionError:
        pass

def docker(args, check=True):
    result = root(['docker'] + args, check=False)
    if result.returncode == 0:
        return result
    if os.geteuid() != 0:
        result = root(['docker'] + args, check=False)
    if check and result.returncode:
        raise RuntimeError(result.stderr[-800:])
    return result

def ensure_files():
    for path in (base, runtime, secrets):
        root(['mkdir', '-p', str(path)], check=False)
        root(['chmod', '700', str(path)], check=False)
    if not env_file.exists() or '\\n' in env_file.read_text(errors='ignore'):
        password = subprocess.check_output(['openssl', 'rand', '-hex', '24'], text=True).strip()
        write_root(env_file, 'ONEDEV_DB_PASSWORD=' + password + '\n')
    if not admin_password.exists() or not admin_password.read_text(errors='ignore').strip():
        write_root(admin_password, subprocess.check_output(['openssl', 'rand', '-hex', '24'], text=True).strip() + '\n')
    write_root(compose, """name: ces-infra
services:
  postgres:
    image: postgres:16.15
    restart: unless-stopped
    environment:
      POSTGRES_DB: onedev
      POSTGRES_USER: onedev
      POSTGRES_PASSWORD: ${ONEDEV_DB_PASSWORD}
    volumes:
      - /srv/ces-infra/postgres:/var/lib/postgresql/data
    ports:
      - 127.0.0.1:5432:5432
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U onedev -d onedev"]
      interval: 5s
      timeout: 5s
      retries: 30
  onedev:
    image: 1dev/server:16.9.7
    restart: unless-stopped
    environment:
      hibernate_dialect: io.onedev.server.persistence.PostgreSQLDialect
      hibernate_connection_driver_class: org.postgresql.Driver
      hibernate_connection_url: jdbc:postgresql://postgres:5432/onedev
      hibernate_connection_username: onedev
      hibernate_connection_password: ${ONEDEV_DB_PASSWORD}
      initial_user: admin
      initial_password_file: /run/secrets/onedev-admin-password
      initial_email: admin@example.com
      initial_server_url: http://onedev:6610
    secrets:
      - onedev-admin-password
    volumes:
      - /srv/ces-infra/onedev:/opt/onedev
    ports:
      - 127.0.0.1:6610:6610
    depends_on:
      postgres:
        condition: service_healthy
  caddy:
    image: caddy:2.10.2
    restart: unless-stopped
    volumes:
      - /srv/ces-infra/runtime/Caddyfile:/etc/caddy/Caddyfile:ro
    ports:
      - 80:80
      - 127.0.0.1:8080:80
    depends_on:
      - onedev
secrets:
  onedev-admin-password:
    file: /srv/ces-infra/secrets/onedev-admin-password
""")
    write_root(caddyfile, ':80 {\n  reverse_proxy onedev:6610\n}\n')

def http(url, method='GET', body=None):
    import urllib.request, base64
    password = admin_password.read_text().strip()
    auth = base64.b64encode(('admin:' + password).encode()).decode()
    headers = {'Authorization': 'Basic ' + auth}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=15) as response:
        return response.read().decode()

def ensure_project():
    import urllib.error
    for _ in range(120):
        try:
            if http('http://127.0.0.1:6610/~api/server/ready').strip() == 'true':
                break
        except Exception:
            pass
        time.sleep(2)
    else:
        raise RuntimeError('onedev did not become ready')
    try:
        http('http://127.0.0.1:6610/~api/projects/ids/CES')
        return
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    body = {
        'name': 'CES',
        'key': 'CES',
        'description': 'CES self evolution repository',
        'codeManagement': True,
        'packManagement': True,
        'issueManagement': False,
        'wikiManagement': False,
        'gitPackConfig': {},
        'codeIndexingSetting': {},
    }
    http('http://127.0.0.1:6610/~api/projects', 'POST', body)
    http('http://127.0.0.1:6610/~api/projects/ids/CES')

def inspect():
    ids = docker(['compose', '-f', str(compose), '--env-file', str(env_file), 'ps', '-q', service], check=False)
    if ids.returncode or not ids.stdout.strip():
        return None
    result = docker(['inspect', '-f', '{{json .State}}', ids.stdout.strip().splitlines()[0]], check=False)
    if result.returncode:
        return None
    try:
        state = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    return state

def installed():
    state = inspect()
    if state is None:
        return {'state': 'missing'}
    running = state.get('Status') == 'running'
    healthy = running
    if service == 'postgres':
        healthy = running and docker(['compose', '-f', str(compose), '--env-file', str(env_file), 'exec', '-T', 'postgres', 'pg_isready', '-U', 'onedev', '-d', 'onedev'], check=False).returncode == 0
    elif service == 'onedev':
        healthy = running and subprocess.run(['curl', '-fsS', '--max-time', '5', 'http://127.0.0.1:6610/'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    elif service == 'caddy':
        healthy = running and subprocess.run(['curl', '-fsS', '--max-time', '5', 'http://127.0.0.1:8080/'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    return {'state': 'installed', 'version': version, 'targetIdentity': image, 'healthy': healthy, 'packages': []}

def wait_ready():
    deadline = time.time() + 180
    while time.time() < deadline:
        current = installed()
        if current.get('state') == 'installed' and current.get('healthy'):
            return current
        time.sleep(3)
    return installed()

def apply():
    ensure_files()
    docker(['compose', '-f', str(compose), '--env-file', str(env_file), 'up', '-d', service], check=True)
    current = wait_ready()
    if current.get('state') != 'installed' or not current.get('healthy'):
        raise RuntimeError(service + ' did not become healthy')
    if service == 'onedev':
        ensure_project()
    return current

try:
    if operation == 'detect':
        result = {'operation': operation, 'result': installed()}
    elif operation == 'list-candidates':
        result = {'operation': operation, 'candidates': [{'version': version, 'targetIdentity': image, 'packages': [], 'channel': 'stable'}]}
    elif operation == 'resolve':
        before = request.get('installed') or installed()
        action = 'install' if before.get('state') == 'missing' else ('upgrade' if before.get('targetIdentity') != image else 'keep')
        target = request['target']
        result = {'operation': operation, 'change': {
            'software': software, 'recipe': request['recipe'], 'recipeRevision': request['recipeRevision'],
            'action': action, 'before': before, 'target': target, 'dependencies': [],
            'effects': [{'kind': 'service-restart', 'description': {'zh': '容器服务将启动或重启。', 'en': 'The container service will start or restart.'}}],
            'payload': {'service': service, 'image': image},
        }, 'additionalRequirements': []}
    elif operation == 'execute':
        change = request['change']
        before = installed()
        if before.get('state') == 'installed' and before.get('targetIdentity') == change['target']['targetIdentity'] and before.get('healthy'):
            if service == 'onedev':
                ensure_project()
            result = {'operation': operation, 'state': 'completed', 'changes': []}
        else:
            apply()
            result = {'operation': operation, 'state': 'completed', 'changes': [{'kind': 'container', 'service': service, 'image': image}]}
    elif operation == 'verify':
        current = installed()
        result = {'operation': operation, 'result': current, 'healthy': current.get('state') == 'installed' and current.get('healthy')}
    elif operation == 'recover':
        result = {'operation': operation, 'state': 'unknown', 'changes': [], 'code': 'use_host_operation_record'}
    else:
        raise RuntimeError('unknown operation: ' + operation)
    print(json.dumps(result))
except Exception as error:
    if operation == 'detect':
        print(json.dumps({'operation': operation, 'result': {'state': 'unknown', 'code': 'detection_failed', 'detail': str(error)[-500:]}}))
    elif operation == 'execute':
        print(json.dumps({'operation': operation, 'state': 'failed', 'changes': [], 'code': 'installation_failed', 'detail': str(error)[-500:]}))
    else:
        print(str(error)[-500:], file=sys.stderr)
        raise
PY
