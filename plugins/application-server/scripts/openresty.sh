#!/bin/sh
# The recipe runner sends this file inline; JSON input must remain on stdin.
program=$(cat <<'PY'
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import http.client

ROOT = Path('/var/lib/ces/application-server/openresty')
MOUNT = '/etc/ces-openresty'
NAME = 'ces-openresty'
HTTP_PORT = 80
HTTPS_PORT = 443
OWNER = '@smp/console-application-server/openresty-docker'
VERSION = '1.27.1.2'
TAG = VERSION + '-13-alpine'
DIGEST = 'sha256:950d6b5cf5aef91da31745d5693e53dd292c33d6784ff7f52a08261712ce4b07'
IMAGE = 'openresty/openresty:' + TAG + '@' + DIGEST
LABEL = 'cn.ces.openresty.'
COMMAND = ['openresty', '-c', MOUNT + '/nginx.conf', '-g', 'daemon off;']
CHECK = 'openresty -t -q -c ' + MOUNT + '/nginx.conf && wget -q -O /dev/null --header="Host: ces-openresty.invalid" http://127.0.0.1:' + str(HTTP_PORT) + '/__ces_openresty_health'
CONFIG = '''worker_processes auto;
error_log /dev/stderr warn;
pid /var/run/nginx.pid;
events { worker_connections 1024; }
http {
    include /usr/local/openresty/nginx/conf/mime.types;
    default_type application/octet-stream;
    access_log /dev/stdout;
    sendfile on;
    server_tokens off;
    map $http_upgrade $ces_connection_upgrade {
        default upgrade;
        '' close;
    }
    server {
        listen 0.0.0.0:__HTTP_PORT__ default_server;
        server_name ces-openresty.invalid;
        location = /__ces_openresty_health {
            access_log off;
            default_type text/plain;
            return 200 "ces-openresty\\n";
        }
        location / { return 404; }
    }
    server {
        listen 0.0.0.0:__HTTPS_PORT__ ssl default_server;
        server_name _;
        ssl_reject_handshake on;
    }
    include /etc/ces-openresty/sites/*.conf;
}
'''.replace('__HTTP_PORT__', str(HTTP_PORT)).replace('__HTTPS_PORT__', str(HTTPS_PORT))

class Failure(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code

def run(args, timeout=30):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)
    if result.returncode:
        # Configuration diagnostics can contain certificate paths and site data.
        raise Failure('command_failed:' + args[0] + ':' + (args[1] if len(args) > 1 else ''))
    return result.stdout.strip()

def docker(*args, timeout=30):
    return run(['docker', *args], timeout)

def names():
    return docker('container', 'ls', '-a', '--format', '{{.Names}}').splitlines()

def container(name=NAME):
    if name not in names():
        return None
    return json.loads(docker('container', 'inspect', name))[0]

def candidate(architecture):
    if architecture not in ('x86_64', 'aarch64'):
        raise Failure('unsupported_architecture')
    return dict(version=VERSION, targetIdentity='openresty=' + TAG + '@' + DIGEST,
                packages=[dict(manager='docker', name='openresty/openresty', version=TAG,
                               architecture=architecture, source=IMAGE, checksum=DIGEST)], channel='stable')

def safe_path(path):
    if any(p.is_symlink() for p in [path, *path.parents]):
        raise Failure('unsafe_gateway_path')

def owned_root():
    safe_path(ROOT)
    if not ROOT.exists():
        return False
    for item in ('owner', 'nginx.conf', 'sites', 'certs'):
        safe_path(ROOT / item)
    if not (ROOT / 'owner').is_file() or (ROOT / 'owner').read_text() != OWNER:
        raise Failure('unmanaged_gateway_directory')
    if ROOT.stat().st_uid != os.geteuid():
        raise Failure('unmanaged_gateway_directory')
    return True

def write_new(path, content):
    with path.open('x') as stream:
        stream.write(content)

def prepare_root():
    if not owned_root():
        ROOT.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Atomic rename avoids leaving an unowned half-created root after interruption.
        temporary = Path(tempfile.mkdtemp(prefix='.openresty-', dir=ROOT.parent))
        try:
            write_new(temporary / 'owner', OWNER)
            write_new(temporary / 'nginx.conf', CONFIG)
            (temporary / 'sites').mkdir(mode=0o700)
            (temporary / 'certs').mkdir(mode=0o700)
            temporary.rename(ROOT)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
    if not (ROOT / 'nginx.conf').is_file() or (ROOT / 'nginx.conf').read_text() != CONFIG:
        raise Failure('gateway_base_config_changed')
    if any(not (ROOT / name).is_dir() for name in ('sites', 'certs')):
        raise Failure('gateway_directory_incomplete')

def identity(info):
    labels = info['Config'].get('Labels') or {}
    version, image = labels.get(LABEL + 'version', ''), info['Config'].get('Image', '')
    if labels.get(LABEL + 'owner') != OWNER or not re.fullmatch(r'\d+\.\d+\.\d+\.\d+', version):
        raise Failure('unmanaged_gateway_container')
    match = re.fullmatch(r'openresty/openresty:(' + re.escape(version) + r'-\d+-alpine)@(sha256:[a-f0-9]{64})', image)
    if not match:
        raise Failure('gateway_image_not_pinned')
    mounts = info.get('Mounts', [])
    if (info['HostConfig'].get('NetworkMode') != 'host' or info['Config'].get('Cmd') != COMMAND
            or info['Config'].get('Entrypoint') not in (None, [])
            or len(mounts) != 1 or mounts[0].get('Source') != str(ROOT)
            or mounts[0].get('Destination') != MOUNT or mounts[0].get('RW') is not False):
        raise Failure('gateway_container_drift')
    actual = json.loads(docker('image', 'inspect', image))[0]
    if actual['Id'] != info['Image']:
        raise Failure('gateway_image_drift')
    architecture = {'amd64': 'x86_64', 'arm64': 'aarch64'}.get(actual['Architecture'])
    if not architecture:
        raise Failure('unsupported_architecture')
    tag, digest = match.groups()
    return dict(state='installed', version=version, targetIdentity='openresty=' + tag + '@' + digest,
                packages=[dict(manager='docker', name='openresty/openresty', version=tag,
                               architecture=architecture, source=image, checksum=digest)], healthy=False)

def detect():
    managed = owned_root()
    if not shutil.which('docker'):
        if managed:
            raise Failure('docker_missing_for_existing_gateway')
        return dict(state='missing')
    info = container()
    if info is None:
        return dict(state='missing')
    result = identity(info)
    if not managed:
        raise Failure('gateway_directory_missing')
    if not (ROOT / 'nginx.conf').is_file() or (ROOT / 'nginx.conf').read_text() != CONFIG:
        raise Failure('gateway_base_config_changed')
    if info['State'].get('Running'):
        try:
            # nginx -v writes to stderr, while the recipe protocol uses stdout.
            version = run(['docker', 'exec', NAME, 'sh', '-c', 'openresty -v 2>&1'])
            if version != 'nginx version: openresty/' + result['version']:
                raise Failure('gateway_version_drift')
            docker('exec', NAME, 'openresty', '-t', '-q', '-c', MOUNT + '/nginx.conf')
            check_listeners()
            result['healthy'] = info['HostConfig'].get('RestartPolicy', {}).get('Name') == 'unless-stopped'
        except (Failure, OSError, http.client.HTTPException) as error:
            result['detail'] = error.code if isinstance(error, Failure) else 'gateway_listener_unhealthy'
    return result

def check_listeners():
    connection = http.client.HTTPConnection('127.0.0.1', HTTP_PORT, timeout=3)
    try:
        connection.request('GET', '/__ces_openresty_health', headers={'Host': 'ces-openresty.invalid'})
        response = connection.getresponse()
        if response.status != 200 or response.read(128) != b'ces-openresty\n':
            raise Failure('gateway_http_listener_unhealthy')
    finally:
        connection.close()
    # The default TLS server deliberately rejects unknown SNI without a fake certificate.
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    with socket.create_connection(('127.0.0.1', HTTPS_PORT), timeout=3) as connection:
        try:
            with context.wrap_socket(connection, server_hostname='ces-openresty.invalid'):
                raise Failure('gateway_tls_default_changed')
        except ssl.SSLError as error:
            if error.reason != 'TLSV1_UNRECOGNIZED_NAME':
                raise Failure('gateway_tls_listener_unhealthy') from error

def require_free_ports():
    for port in (HTTP_PORT, HTTPS_PORT):
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                listener.bind(('0.0.0.0', port))
            except OSError as error:
                raise Failure('gateway_port_in_use_' + str(port)) from error

def create(image, version):
    return docker('create', '--name', NAME, '--network', 'host', '--restart', 'unless-stopped',
                  '--label', LABEL + 'owner=' + OWNER, '--label', LABEL + 'version=' + version,
                  '--mount', 'type=bind,src=' + str(ROOT) + ',dst=' + MOUNT + ',readonly',
                  '--log-driver', 'json-file', '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3',
                  '--health-cmd', CHECK, '--health-interval', '30s', '--health-timeout', '5s',
                  '--health-retries', '3', '--entrypoint', '', image, *COMMAND)

def install(request):
    change = request['change']
    target = candidate(request['os']['architecture'])
    if change['target'] != target or change['payload'] != dict(image=IMAGE):
        raise Failure('gateway_plan_changed')
    safe_path(ROOT)
    ROOT.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = os.open(str(ROOT.parent / 'openresty.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = detect()
        if before.get('targetIdentity') == target['targetIdentity'] and before.get('healthy'):
            return []
        if before != change['before']:
            raise Failure('gateway_changed_after_preflight')
        if before['state'] == 'missing':
            require_free_ports()
        backup = NAME + '-previous'
        if backup in names():
            raise Failure('gateway_previous_container_requires_recovery')
        prepare_root()
        # A digest is immutable. Recreating a gateway must not require registry
        # availability when that exact image is already in the local cache.
        cached = docker('image', 'ls', '--digests', '--format', '{{.Repository}}@{{.Digest}}').splitlines()
        if 'openresty/openresty@' + DIGEST not in cached:
            docker('pull', IMAGE, timeout=420)
        # Test the new binary against all preserved sites before stopping the old gateway.
        docker('run', '--rm', '--network', 'host', '--mount',
               'type=bind,src=' + str(ROOT) + ',dst=' + MOUNT + ',readonly',
               '--entrypoint', 'openresty', IMAGE, '-t', '-q', '-c', MOUNT + '/nginx.conf')
        old = container()
        if old:
            identity(old)
            docker('rename', NAME, backup)
        created = None
        try:
            if old:
                docker('stop', '--time', '10', backup)
            created = create(IMAGE, VERSION)
            docker('start', created)
            for attempt in range(10):
                actual = detect()
                if actual.get('healthy'):
                    break
                time.sleep(0.5)
            else:
                raise Failure('gateway_start_failed')
        except (Failure, OSError, subprocess.TimeoutExpired):
            if created:
                docker('rm', '-f', created)
            if old:
                docker('rename', backup, NAME)
                if old['State'].get('Running'):
                    docker('start', NAME)
            raise
        if old:
            docker('rm', backup)
        return [dict(kind='container', name=NAME, image=IMAGE, configuration=str(ROOT))]
    finally:
        os.close(lock)

def handle(request):
    operation = request['operation']
    if operation == 'detect':
        return dict(operation=operation, result=detect())
    if operation == 'list-candidates':
        return dict(operation=operation, candidates=[candidate(request['os']['architecture'])])
    if operation == 'resolve':
        if request['target'] != candidate(request['os']['architecture']):
            raise Failure('gateway_target_changed')
        if request['installed']['state'] == 'missing':
            require_free_ports()
        return dict(operation=operation, additionalRequirements=[], change=dict(
            software=request['software'], recipe=request['recipe'], recipeRevision=request['recipeRevision'],
            action=request.get('action', 'install'), before=request['installed'], target=request['target'],
            dependencies=['@smp/console-container-runtime/docker-engine'],
            effects=[dict(kind='service-restart', description=dict(
                zh='安装或替换 OpenResty 网关容器并监听 80/443；保留站点配置，替换时短暂中断网站入口。无证书的默认 443 拒绝 TLS 握手。',
                en='Install or replace the OpenResty gateway on ports 80/443, preserving sites. Replacement briefly interrupts ingress. Default TLS rejects handshakes until a site certificate is configured.'))],
            payload=dict(image=IMAGE)))
    if operation == 'execute':
        return dict(operation=operation, state='completed', changes=install(request))
    if operation in ('verify', 'recover'):
        actual = detect()
        healthy = actual.get('healthy', False) and actual.get('targetIdentity') == request['change']['target']['targetIdentity']
        if operation == 'verify':
            return dict(operation=operation, result=actual, healthy=healthy)
        # Interrupted replacements may leave the prior container; never delete it on a guess.
        previous = shutil.which('docker') and NAME + '-previous' in names()
        return dict(operation=operation, state='completed' if healthy and not previous else 'unknown',
                    changes=[], code='gateway_observed' if healthy and not previous else 'gateway_manual_verification_required')
    raise Failure('invalid_operation')

def main():
    request = json.load(sys.stdin)
    operation = request['operation']
    try:
        if os.geteuid() != 0:
            raise Failure('root_required')
        result = handle(request)
    except (Failure, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        code = error.code if isinstance(error, Failure) else 'gateway_operation_failed'
        if operation == 'detect':
            result = dict(operation=operation, result=dict(state='unknown', code=code))
        elif operation == 'execute':
            result = dict(operation=operation, state='failed', changes=[], code=code)
        elif operation == 'recover':
            result = dict(operation=operation, state='unknown', changes=[], code=code)
        else:
            print(code, file=sys.stderr)
            return 1
    print(json.dumps(result))
    return 0

if __name__ == '__main__':
    sys.exit(main())
PY
)
if [ "$(id -u)" = 0 ]; then
    exec python3 -c "$program"
else
    exec sudo -n python3 -c "$program"
fi
