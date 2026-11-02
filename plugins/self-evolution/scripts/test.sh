#!/bin/sh
set -eu
input=$(mktemp)
trap 'rm -f "$input"' EXIT
cat > "$input"
python3 - "$input" <<'PY'
import base64, grp, json, os, pwd, shutil, subprocess, sys, time
from pathlib import Path

request = json.load(open(sys.argv[1]))
operation = request['operation']
software = request['software']
prefix = '@smp/console-self-evolution/'
agent = prefix + 'onedev-build-agent'
services = {
    prefix + 'postgresql': ('postgres-test', 'postgres:16.15', '16.15.0'),
    prefix + 'caddy': ('caddy', 'caddy:2.10.2', '2.10.2'),
}
is_agent = software == agent
if not is_agent and software not in services:
    raise SystemExit('unsupported software: ' + software)
if is_agent:
    service, image, version = 'onedev-agent', 'onedev-agent:ces-build-agent', '3.3.12'
else:
    service, image, version = services[software]
base = Path('/srv/ces-test')
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
        gid = grp.getgrnam('cesagent').gr_gid
        os.chown(base, 0, gid)
        os.chmod(base, 0o750)
    except KeyError:
        os.chmod(base, 0o700)
    for path in (runtime, secrets, base / 'postgres', base / 'caddy'):
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(path, 0o700)
    secret(secrets / 'test-db-password')
    write(env_file, 'TEST_DB_PASSWORD=' + (secrets / 'test-db-password').read_text().strip() + '\n')
    write(compose, """name: ces-test
services:
  postgres-test:
    image: postgres:16.15
    restart: unless-stopped
    environment:
      POSTGRES_DB: ces_test
      POSTGRES_USER: ces
      POSTGRES_PASSWORD: ${TEST_DB_PASSWORD}
    volumes:
      - /srv/ces-test/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ces -d ces_test"]
      interval: 5s
      timeout: 5s
      retries: 30
  caddy:
    image: caddy:2.10.2
    restart: unless-stopped
    volumes:
      - /srv/ces-test/runtime/Caddyfile:/etc/caddy/Caddyfile:ro
    ports:
      - 80:80
    depends_on:
      postgres-test:
        condition: service_healthy
""")
    write(caddyfile, ':80 {\n  encode zstd gzip\n  reverse_proxy candidate-ces:9090\n}\n')
    encryption = secrets / 'candidate-encryption-key'
    if not encryption.exists():
        write(encryption, base64.urlsafe_b64encode(os.urandom(32)).decode() + '\n')
    session = secrets / 'candidate-session-secret'
    if not session.exists():
        write(session, subprocess.check_output(['openssl', 'rand', '-hex', '24'], text=True).strip() + '\n')
    candidate_env = base / 'candidate.env'
    public_host = (secrets / 'public-host').read_text().strip() if (secrets / 'public-host').exists() else ''
    candidate_text = ('DATABASE_URL=postgresql://ces:%s@postgres-test:5432/ces_test\n'
          'ENCRYPTION_KEY=%s\nSESSION_SECRET=%s\nINITIAL_PASSWORD=changeme\n' % (
              (secrets / 'test-db-password').read_text().strip(),
              encryption.read_text().strip(),
              session.read_text().strip()))
    if public_host:
        candidate_text += 'TRUSTED_HOST=' + public_host + '\n'
    write(candidate_env, candidate_text)
    try:
        account = pwd.getpwnam('cesagent')
        os.chown(candidate_env, account.pw_uid, account.pw_gid)
    except KeyError:
        pass

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

def systemctl_active():
    result = run(['systemctl', 'is-active', 'onedev.agent'], check=False)
    return result.returncode == 0

def agent_installed():
    if systemctl_active():
        return {'state': 'installed', 'version': version, 'targetIdentity': image, 'healthy': True, 'packages': []}
    return {'state': 'missing'}

def ensure_agent():
    token = secrets / 'onedev-agent-token'
    server = secrets / 'onedev-server-url'
    package = base / 'bootstrap' / 'agent.tar.gz'
    if not token.exists() or not server.exists():
        raise RuntimeError('agent_bootstrap_missing')
    if not package.exists():
        raise RuntimeError('agent_package_missing')
    account = pwd.getpwnam('cesagent')
    target = base / 'agent'
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    run(['tar', '-xzf', str(package), '-C', str(target), '--strip-components=1'])
    run(['chown', '-R', '%d:%d' % (account.pw_uid, account.pw_gid), str(target)])
    config = target / 'conf' / 'agent.properties'
    write(config, 'serverUrl=%s\nagentTokenFile=%s\nagentName=ces-build-agent\n' % (
        server.read_text().strip(), token))
    os.chown(config, account.pw_uid, account.pw_gid)
    run(['bash', '-c', 'cd %s && RUN_AS_USER=cesagent ./bin/agent.sh install' % target])
    run(['systemctl', 'start', 'onedev.agent'], check=False)
    for _ in range(60):
        if systemctl_active():
            return
        time.sleep(2)
    raise RuntimeError('agent service did not become active')

def installed():
    if is_agent:
        return agent_installed()
    state = inspect()
    if state is None:
        return {'state': 'missing'}
    running = state.get('Status') == 'running'
    healthy = running
    if service == 'postgres-test':
        healthy = running and compose_run('exec', '-T', 'postgres-test', 'pg_isready', '-U', 'ces', '-d', 'ces_test', check=False).returncode == 0
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
    if is_agent:
        ensure_agent()
        current = installed()
        if current.get('state') != 'installed' or not current.get('healthy'):
            raise RuntimeError('onedev agent did not become active')
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
            'effects': [{'kind': 'service-restart', 'description': {'zh': '容器服务将启动或重启。', 'en': 'The container service will start or restart.'}}],
            'payload': {'service': service, 'image': image, 'agentName': 'ces-build-agent'},
        }, 'additionalRequirements': []}
    elif operation == 'execute':
        change = request['change']
        before = installed()
        if before.get('state') == 'installed' and before.get('targetIdentity') == change['target']['targetIdentity'] and before.get('healthy'):
            result = {'operation': operation, 'state': 'completed', 'changes': []}
        else:
            apply()
            kind = 'service' if is_agent else 'container'
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
