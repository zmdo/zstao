import fcntl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import platform
import shutil
import socket
import subprocess
import threading
import time
import urllib.request
import urllib.error

BASE = Path('/var/lib/ces-openresty-smoke')
ROOT = BASE / 'gateway'
NAME = 'ces-openresty-smoke'

def port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

http_port, https_port = port(), port()
assert not ROOT.exists(), 'Refuse to reuse an existing smoke directory'
existing = subprocess.check_output(['docker', 'ps', '-a', '--format', '{{.Names}}'], text=True).splitlines()
assert NAME not in existing and NAME+'-previous' not in existing, 'Refuse to reuse an existing container'
source = Path('/work/openresty.sh').read_text().replace("Path('/var/lib/ces/application-server/openresty')", "Path('/var/lib/ces-openresty-smoke/gateway')").replace("NAME = 'ces-openresty'", "NAME = 'ces-openresty-smoke'")
source = source.replace('HTTP_PORT = 80', 'HTTP_PORT = '+str(http_port)).replace('HTTPS_PORT = 443', 'HTTPS_PORT = '+str(https_port))
Path('/work/recipe.sh').write_text(source)

def shell(args, **kw):
    return subprocess.run(args, text=True, capture_output=True, timeout=480, **kw)

def docker(*args):
    result = shell(['docker', *args])
    assert result.returncode == 0, (args, result.stderr)
    return result.stdout.strip()

architecture = {'aarch64': 'aarch64', 'x86_64': 'x86_64'}[platform.machine()]
env = dict(contractVersion=2, os=dict(family='builtin/ubuntu', version='24.04', architecture=architecture, raw={}),
           software='@smp/console-application-server/openresty', recipe='@smp/console-application-server/openresty-docker',
           recipeRevision='smoke', effectiveVersions=dict(kind='any'))

def recipe(operation, **kw):
    result = shell(['sh', '/work/recipe.sh'], input=json.dumps(dict(env, operation=operation, **kw)))
    assert result.returncode == 0, (operation, result.stderr)
    return json.loads(result.stdout)

class App(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('X-CES-Release', 'untrusted-upstream-header')
        self.end_headers()
        self.wfile.write(json.dumps(dict(ok=True, host=self.headers.get('Host'), path=self.path)).encode())
    def log_message(self, *args):
        pass

app = ThreadingHTTPServer(('127.0.0.1', 0), App)
threading.Thread(target=app.serve_forever, daemon=True).start()
public, domain_port = http_port, http_port
template = Path('/work/site.conf').read_text()

def site(domain, release, listener, upstream=None):
    values = dict(PUBLIC_PORT=str(listener), SERVER_NAME=domain, RELEASE_ID=release,
                  UPSTREAM_PORT=str(upstream or app.server_port),
                  HOST_GUARD='' if domain == '127.0.0.1' else 'if ($host != "' + domain + '") { return 444; }')
    result = template
    # Drop template comments; placeholder examples in comments aren't actual configuration.
    result = '\n'.join(line for line in result.splitlines() if not line.lstrip().startswith('#'))
    for key, value in values.items():
        result = result.replace('__'+key+'__', value)
    assert '__' not in result
    return result + '\n'

def nginx(*args):
    return docker('exec', NAME, 'openresty', *args, '-c', '/etc/ces-openresty/nginx.conf')

def get(listener, host, release, status=200):
    last = None
    for _ in range(30):
        try:
            request = urllib.request.Request('http://127.0.0.1:'+str(listener)+'/api/check', headers={'Host':host})
            try:
                response = urllib.request.urlopen(request, timeout=2)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                body = response.read()
                assert response.status == status, (response.status, body)
                assert response.headers.get('X-CES-Release') == release, dict(response.headers)
                return body
        except (OSError, AssertionError) as error:
            last = error
            time.sleep(.1)
    raise AssertionError(last)

try:
    before = recipe('detect')['result']
    assert before == {'state':'missing'}, before
    target = recipe('list-candidates', installed=before)['candidates'][0]
    change = recipe('resolve', target=target, installed=before)['change']
    execute = recipe('execute', change=change, operationId='smoke-install', planDigest='test')
    assert execute['state'] == 'completed', execute
    verification = recipe('verify', change=change, operationId='smoke-install', planDigest='test')
    assert verification['healthy'], verification
    print('PASS real shell recipe install / detect / verify ('+architecture+')', flush=True)
    assert 'listen 0.0.0.0:'+str(http_port)+' default_server' in (ROOT/'nginx.conf').read_text()
    assert 'listen 0.0.0.0:'+str(https_port)+' ssl default_server' in (ROOT/'nginx.conf').read_text()
    assert not list((ROOT/'sites').iterdir())
    old_id = docker('inspect', '--format', '{{.Id}}', NAME)
    assert recipe('execute', change=change, operationId='smoke-retry', planDigest='test')['changes'] == []
    assert docker('inspect', '--format', '{{.Id}}', NAME) == old_id
    print('PASS default HTTP/TLS listeners / idempotent installation', flush=True)
    (ROOT/'sites/ip.conf').write_text(site('127.0.0.1', 'release-ip', public))
    (ROOT/'sites/domain.conf').write_text(site('first.example.test', 'release-domain', domain_port))
    (ROOT/'sites/second.conf').write_text(site('second.example.test', 'release-second', domain_port))
    nginx('-t', '-q')
    nginx('-s', 'reload')
    assert json.loads(get(public, '127.0.0.1', 'release-ip'))['ok']
    assert json.loads(get(domain_port, 'first.example.test', 'release-domain'))['host'] == 'first.example.test'
    assert json.loads(get(domain_port, 'second.example.test', 'release-second'))['host'] == 'second.example.test'
    try:
        urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:'+str(domain_port), headers={'Host':'unknown.example.test'}), timeout=2)
    except urllib.error.HTTPError as error:
        assert error.code == 404, error.code
    else:
        raise AssertionError('Unknown hostname must not receive a domain site')
    print('PASS IP forwarding / two domains share port / unknown Host rejection', flush=True)
    site_path = ROOT/'sites/domain.conf'
    backup = site_path.read_text()
    lock = (BASE/'openresty.lock').open('a')
    with lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        site_path.write_text('this is invalid nginx syntax;\n')
        invalid = shell(['docker','exec',NAME,'openresty','-t','-q','-c','/etc/ces-openresty/nginx.conf'])
        assert invalid.returncode != 0
        get(domain_port, 'first.example.test', 'release-domain')
        site_path.write_text(backup)
        nginx('-t', '-q')
        nginx('-s', 'reload')
        get(domain_port, 'first.example.test', 'release-domain')
        site_path.write_text(site('first.example.test', 'release-bad', domain_port, upstream=port()))
        nginx('-t', '-q')
        nginx('-s', 'reload')
        get(domain_port, 'first.example.test', 'release-bad', status=502)
        site_path.write_text(backup)
        nginx('-t', '-q')
        nginx('-s', 'reload')
        get(domain_port, 'first.example.test', 'release-domain')
    print('PASS invalid config rejected / unreachable upstream detected / old route restored', flush=True)
    docker('rm', '-f', NAME)
    missing = recipe('detect')['result']
    assert missing == {'state':'missing'}
    change = recipe('resolve', target=target, installed=missing)['change']
    recreated = recipe('execute', change=change, operationId='smoke-recreate', planDigest='test')
    assert recreated['state'] == 'completed', recreated
    assert site_path.read_text() == backup
    get(domain_port, 'first.example.test', 'release-domain')
    print('PASS recreate container preserves existing sites and real traffic', flush=True)
finally:
    app.shutdown()
    shell(['docker', 'rm', '-f', NAME])
    shell(['docker', 'rm', '-f', NAME+'-previous'])
    if ROOT.exists():
        shutil.rmtree(ROOT)
    (BASE/'openresty.lock').unlink(missing_ok=True)
