#!/bin/sh
set -eu
input=$(mktemp)
trap 'rm -f "$input"' EXIT
cat > "$input"
python3 - "$input" <<'PY'
import base64, grp, json, os, pwd, subprocess, sys, time
from pathlib import Path

request = json.load(open(sys.argv[1]))
operation = request['operation']
software = request['software']
prefix = '@smp/console-self-evolution/'
host_software = prefix + 'ces-host'
services = {
    prefix + 'postgresql': ('postgres-prod', 'postgres:16.15', '16.15.0'),
    prefix + 'caddy': ('caddy', 'caddy:2.10.2', '2.10.2'),
}
is_host = software == host_software
if not is_host and software not in services:
    raise SystemExit('unsupported software: ' + software)
if is_host:
    service, image, version = 'ces-host', 'ces-host:1.0.0', '1.0.0'
else:
    service, image, version = services[software]
base = Path('/srv/ces-prod')
runtime = base / 'runtime'
secrets = base / 'secrets'
compose = runtime / 'compose.yml'
env_file = runtime / '.env'
caddyfile = runtime / 'Caddyfile'
os.umask(0o077)

def run(args, check=True, input_text=None):
    result = subprocess.run(args, text=True, input=input_text,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and result.returncode:
        raise RuntimeError(result.stderr[-800:])
    return result

def docker(args, check=True):
    result = run(['docker'] + args, check=False)
    if result.returncode and os.geteuid() != 0:
        result = run(['sudo', '-n', 'docker'] + args, check=False)
    if check and result.returncode:
        raise RuntimeError(result.stderr[-800:])
    return result

def write(path, content, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not (path.exists() and path.read_text(errors='ignore') == content):
        path.write_text(content)
    os.chmod(path, mode)

def secret(path):
    path = Path(path)
    if not path.exists() or not path.read_text().strip():
        write(path, subprocess.check_output(['openssl', 'rand', '-hex', '24'], text=True).strip() + '\n')
    return path.read_text().strip()

def compose_run(*args, check=True):
    return docker(['compose', '-f', str(compose), '--env-file', str(env_file)] + list(args), check=check)

def ensure_files():
    base.mkdir(parents=True, exist_ok=True)
    try:
        gid = pwd.getpwnam('cesdeploy').pw_gid
        os.chown(base, 0, gid)
        os.chmod(base, 0o750)
    except KeyError:
        os.chmod(base, 0o700)
    for path in (runtime, secrets, base / 'postgres', base / 'caddy'):
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(path, 0o700)
    secret(secrets / 'prod-db-password')
    write(env_file, 'PROD_DB_PASSWORD=' + (secrets / 'prod-db-password').read_text().strip() + '\n')
    write(compose, """name: ces-prod
services:
  postgres-prod:
    image: postgres:16.15
    restart: unless-stopped
    environment:
      POSTGRES_DB: ces
      POSTGRES_USER: ces
      POSTGRES_PASSWORD: ${PROD_DB_PASSWORD}
    volumes:
      - /srv/ces-prod/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ces -d ces"]
      interval: 5s
      timeout: 5s
      retries: 30
  caddy:
    image: caddy:2.10.2
    restart: unless-stopped
    volumes:
      - /srv/ces-prod/runtime/Caddyfile:/etc/caddy/Caddyfile:ro
    ports:
      - 80:80
    depends_on:
      postgres-prod:
        condition: service_healthy
""")
    write(caddyfile, ':80 {\n  encode zstd gzip\n  reverse_proxy prod-ces:9090\n}\n')
    encryption = secrets / 'prod-encryption-key'
    if not encryption.exists():
        write(encryption, base64.urlsafe_b64encode(os.urandom(32)).decode() + '\n')
    session = secrets / 'prod-session-secret'
    if not session.exists():
        write(session, subprocess.check_output(['openssl', 'rand', '-hex', '24'], text=True).strip() + '\n')
    public_host = (secrets / 'public-host').read_text().strip() if (secrets / 'public-host').exists() else ''
    prod_text = ('DATABASE_URL=postgresql://ces:%s@postgres-prod:5432/ces\n'
          'ENCRYPTION_KEY=%s\nSESSION_SECRET=%s\nINITIAL_PASSWORD=changeme\n' % (
              (secrets / 'prod-db-password').read_text().strip(),
              encryption.read_text().strip(), session.read_text().strip()))
    if public_host:
        prod_text += 'TRUSTED_HOST=' + public_host + '\n'
    write(base / 'prod.env', prod_text)

def ensure_host():
    ensure_files()
    key = secrets / 'authorized_keys'
    if not key.exists() or not key.read_text().strip():
        raise RuntimeError('deploy_key_missing')
    try:
        account = pwd.getpwnam('cesdeploy')
    except KeyError:
        run(['useradd', '--system', '--home', str(base), '--shell', '/bin/bash', '--no-create-home', 'cesdeploy'])
        account = pwd.getpwnam('cesdeploy')
    for name in ('runtime', 'data', 'bin', 'backups'):
        path = base / name
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chown(path, account.pw_uid, account.pw_gid)
        os.chmod(path, 0o700)
    ssh_dir = base / '.ssh'
    ssh_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chown(ssh_dir, account.pw_uid, account.pw_gid)
    target = ssh_dir / 'authorized_keys'
    write(target, key.read_text(), 0o600)
    os.chown(target, account.pw_uid, account.pw_gid)
    wrapper = Path('/usr/local/sbin/ces-runtime')
    bootstrap = base / 'bootstrap' / 'ces-runtime.sh'
    if bootstrap.exists():
        write(wrapper, bootstrap.read_text(), 0o755)
    else:
        write(wrapper, """#!/bin/sh
set -eu
echo "ces-runtime: bootstrap script is missing" >&2
exit 1
""", 0o755)
    sudoers = Path('/etc/sudoers.d/cesdeploy')
    write(sudoers, 'cesdeploy ALL=(root) NOPASSWD: /usr/local/sbin/ces-runtime\n', 0o440)
    run(['visudo', '-cf', str(sudoers)])
    os.chown(base, 0, account.pw_gid)
    os.chmod(base, 0o750)

def path_exists(path):
    result = run(['test', '-e', str(path)], check=False)
    if result.returncode == 0:
        return True
    return run(['sudo', '-n', 'test', '-e', str(path)], check=False).returncode == 0

def host_installed():
    try:
        account = pwd.getpwnam('cesdeploy')
    except KeyError:
        return {'state': 'missing'}
    required = [base / 'runtime', base / 'data', base / 'bin', base / 'backups',
                base / '.ssh' / 'authorized_keys', Path('/usr/local/sbin/ces-runtime'),
                Path('/etc/sudoers.d/cesdeploy')]
    if not all(path_exists(path) for path in required):
        return {'state': 'missing'}
    return {'state': 'installed', 'version': version, 'targetIdentity': image, 'healthy': True, 'packages': []}

def inspect():
    ids = compose_run('ps', '-q', service, check=False)
    if ids.returncode or not ids.stdout.strip():
        return None
    result = docker(['inspect', '-f', '{{json .State}}', ids.stdout.strip().splitlines()[0]], check=False)
    if result.returncode:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None

def installed():
    if is_host:
        return host_installed()
    state = inspect()
    if state is None:
        return {'state': 'missing'}
    running = state.get('Status') == 'running'
    healthy = running
    if service == 'postgres-prod':
        healthy = running and compose_run('exec', '-T', 'postgres-prod', 'pg_isready', '-U', 'ces', '-d', 'ces', check=False).returncode == 0
    elif service == 'caddy':
        healthy = running and compose_run('exec', '-T', 'caddy', 'sh', '-c', 'caddy version', check=False).returncode == 0
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
    if is_host:
        ensure_host()
        current = installed()
        if current.get('state') != 'installed' or not current.get('healthy'):
            raise RuntimeError('ces-host did not become ready')
        return current
    ensure_files()
    compose_run('up', '-d', service, check=True)
    current = wait_ready()
    if current.get('state') != 'installed' or not current.get('healthy'):
        raise RuntimeError(service + ' did not become healthy')
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
            'effects': [{'kind': 'service-restart', 'description': {'zh': '服务或宿主配置将更新。', 'en': 'The service or host configuration will be updated.'}}],
            'payload': {'service': service, 'image': image},
        }, 'additionalRequirements': []}
    elif operation == 'execute':
        change = request['change']
        before = installed()
        if before.get('state') == 'installed' and before.get('targetIdentity') == change['target']['targetIdentity'] and before.get('healthy'):
            result = {'operation': operation, 'state': 'completed', 'changes': []}
        else:
            apply()
            kind = 'user' if is_host else 'container'
            result = {'operation': operation, 'state': 'completed', 'changes': [{'kind': kind, 'service': service, 'image': image}]}
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
