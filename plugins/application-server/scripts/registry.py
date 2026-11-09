#!/usr/bin/env python3
"""CES managed registry helper. Secrets arrive over stdin and never enter its journal."""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import uuid

ROOT = Path('/var/lib/ces/docker-config')
LOCK_ROOT = Path('/var/lib/smp-server-management')
HELPER = Path('/usr/local/sbin/ces-registry')
RUNTIME = '/usr/local/sbin/ces-runtime'

class Failure(Exception):
    def __init__(self, code, pulled=False):
        super().__init__(code)
        self.pulled = pulled

def directory(path):
    if path.is_symlink():
        raise Failure('unsafe_path')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not path.is_dir() or path.stat().st_uid != os.geteuid():
        raise Failure('unsafe_path')
    path.chmod(0o700)

def atomic(path, data, mode=0o600):
    fd, temporary = tempfile.mkstemp(prefix='.ces-', dir=str(path.parent))
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        parent = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def write_json(path, value):
    atomic(path, json.dumps(value, sort_keys=True).encode())

def read_json(path):
    try:
        if path.is_symlink():
            raise Failure('unsafe_path')
        return json.loads(path.read_text())
    except (FileNotFoundError, ValueError):
        return None

def ident(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,80}', value):
        raise Failure('invalid_request')
    return value

def number(value):
    if not re.fullmatch(r'[0-9]{1,18}', str(value)):
        raise Failure('invalid_request')
    return int(value)

def current(base):
    link = base / 'current'
    if not link.is_symlink():
        return None
    target = os.readlink(link)
    if not re.fullmatch(r'generations/[a-zA-Z0-9-]{1,80}', target):
        raise Failure('unsafe_path')
    path = base / target
    if path.is_symlink():
        raise Failure('unsafe_path')
    meta = read_json(path / 'metadata.json')
    config = read_json(path / 'config.json')
    if not meta or not config or config.get('credsStore') or config.get('credHelpers'):
        return None
    try:
        auth = config['auths'][meta['registry']]['auth']
        decoded = base64.b64decode(auth, validate=True).decode()
        if ':' not in decoded or not decoded.split(':', 1)[1]:
            return None
        if hashlib.sha256((path / 'config.json').read_bytes()).hexdigest() != meta['configHash']:
            return None
    except (KeyError, ValueError, UnicodeError):
        return None
    if (path / 'config.json').stat().st_mode & 0o077:
        return None
    return path, meta

def scoped(repository, scopes):
    return any(repository == s or (s.endswith('/*') and repository.startswith(s[:-1])) for s in scopes)

def receipt(meta, generation):
    return {key: meta[key] for key in ('serverId', 'credentialId', 'revision', 'configRevision')} | {'generation': generation}

def configure(request, base):
    sequence = number(request['sequence'])
    fence = number(request['fence'])
    operation = ident(request['operationId'])
    revision = number(request['revision'])
    watermark = read_json(base / 'watermark.json') or {}
    if (sequence, fence) < (number(watermark.get('sequence', 0)), number(watermark.get('fence', 0))):
        raise Failure('superseded')
    if revision < number(watermark.get('revision', 0)):
        raise Failure('superseded')
    # Stored before side effects. Reclaims of the same operation have increasing fences.
    write_json(base / 'watermark.json', {'sequence': sequence, 'fence': fence, 'revision': revision, 'operationId': operation, 'configRevision': request['configRevision']})
    if request['action'] == 'remove':
        if (base / 'current').exists() or (base / 'current').is_symlink():
            (base / 'current').unlink()
        generations = base / 'generations'
        if generations.is_symlink():
            raise Failure('unsafe_path')
        if generations.exists():
            shutil.rmtree(generations)
        return {'removed': True, 'revision': revision}
    found = current(base)
    if found:
        path, meta = found
        if meta.get('revision') == revision and meta.get('registry') == request['registry'] and meta.get('serverId') == request['serverId'] and meta.get('credentialId') == request['credentialId']:
            if meta.get('configRevision') != request['configRevision'] or meta.get('repositories') != request['repositories']:
                meta['configRevision'] = request['configRevision']
                meta['repositories'] = request['repositories']
                write_json(path / 'metadata.json', meta)
            return {'receipt': receipt(meta, path.name), 'reused': True}
    if request.get('password') is None:
        return {'needsCredentials': True}
    directory(base / 'generations')
    # The operation id survives a lost SSH response. A damaged generation is replaced.
    generation = base / 'generations' / operation
    if generation.is_symlink():
        raise Failure('unsafe_path')
    if generation.exists():
        # Do not destroy the active generation before a successful replacement.
        operation = operation + '-' + uuid.uuid4().hex
        generation = base / 'generations' / operation
    directory(generation)
    # An explicit auth entry prevents Docker's automatic native helper selection.
    write_json(generation / 'config.json', {'auths': {request['registry']: {}}})
    try:
        outcome = subprocess.run(['docker', '--config', str(generation), 'login', request['registry'], '--username', request['username'], '--password-stdin'], input=(request['password'] + '\n').encode(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90)
        if outcome.returncode:
            raise Failure('registry_login_failed')
        config = read_json(generation / 'config.json')
        if not config or not config.get('auths', {}).get(request['registry'], {}).get('auth') or config.get('credsStore') or config.get('credHelpers'):
            raise Failure('registry_config_invalid')
        (generation / 'config.json').chmod(0o600)
        meta = {key: request[key] for key in ('serverId', 'credentialId', 'revision', 'configRevision', 'registry', 'repositories')}
        meta['configHash'] = hashlib.sha256((generation / 'config.json').read_bytes()).hexdigest()
        write_json(generation / 'metadata.json', meta)
        link = base / ('.current-' + operation)
        if link.exists() or link.is_symlink():
            link.unlink()
        os.symlink('generations/' + operation, link)
        os.replace(link, base / 'current')
        parent = os.open(str(base), os.O_RDONLY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
        # Retire stale credential copies under the same lock.
        for old in (base / 'generations').iterdir():
            if old.name != operation and not old.is_symlink():
                shutil.rmtree(old)
        return {'receipt': receipt(meta, operation), 'reused': False}
    except Exception:
        if not (base / 'current').is_symlink() or os.readlink(base / 'current') != 'generations/' + operation:
            shutil.rmtree(generation, ignore_errors=True)
        raise

def pull(request, base, lock_fd):
    found = current(base)
    if not found:
        raise Failure('credential_config_missing')
    path, meta = found
    wanted = request['receipt']
    if wanted != receipt(meta, path.name):
        raise Failure('credential_receipt_stale')
    watermark = read_json(base / 'watermark.json') or {}
    if number(watermark.get('revision', 0)) > meta['revision'] or str(watermark.get('configRevision')) != str(meta['configRevision']):
        raise Failure('credential_receipt_stale')
    image = request.get('image', '')
    match = re.fullmatch(r'([a-z0-9][a-z0-9.:-]*)/([a-z0-9][a-z0-9_./-]*)@sha256:([a-f0-9]{64})', image)
    if not match or match[1] != meta['registry'] or not scoped(match[2], meta['repositories']):
        raise Failure('image_scope_denied')
    result = subprocess.run(['docker', '--config', str(path), 'pull', '--quiet', image], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=600, pass_fds=(lock_fd,))
    if result.returncode:
        error = result.stderr.decode(errors='replace').lower()
        if any(word in error for word in ('unauthorized', 'authentication required', 'no basic auth credentials')):
            raise Failure('registry_auth_failed')
        if 'denied' in error or 'forbidden' in error:
            raise Failure('registry_permission_denied')
        raise Failure('image_pull_failed')
    if request['action'] == 'deploy':
        # Existing installer remains responsible for container replacement and health checks.
        if not Path(RUNTIME).is_file():
            raise Failure('deployment_runtime_missing', pulled=True)
        env = dict(os.environ, DOCKER_CONFIG=str(path), CES_PREPARED_IMAGE=image)
        deployed = subprocess.run([RUNTIME, 'install', '--digest', image], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600, pass_fds=(lock_fd,))
        if deployed.returncode:
            raise Failure('deployment_failed', pulled=True)
    return {'pulled': True, 'deployed': request['action'] == 'deploy', 'image': image, 'receipt': wanted}

def run(request):
    credential = ident(request.get('credentialId', request.get('receipt', {}).get('credentialId')))
    directory(ROOT)
    directory(LOCK_ROOT)
    fd = os.open(str(LOCK_ROOT / 'lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Failure('server_busy')
        base = ROOT / credential
        directory(base)
        if request.get('action') in ('prepare', 'remove'):
            # Only CES's privileged SSH bootstrap can configure; the installed CI entry is pull/deploy only.
            if 'CES_SOURCE' not in globals():
                raise Failure('invalid_request')
            source = globals().get('CES_SOURCE')
            if source and (not HELPER.is_file() or HELPER.is_symlink() or HELPER.read_text() != source):
                atomic(HELPER, source.encode(), 0o700)
            return configure(request, base)
        if request.get('action') in ('deploy', 'deployment-status'):
            operation = ident(request.get('operationId'))
            directory(base / 'deployments')
            journal = base / 'deployments' / (operation + '.json')
            previous = read_json(journal)
            if previous:
                if previous.get('image') != request.get('image'):
                    raise Failure('invalid_request')
                if previous.get('state') == 'finished':
                    return previous['result']
                # The lock is now free but execution did not commit a result. Never replay it.
                raise Failure('deployment_outcome_unknown')
            if request['action'] == 'deployment-status':
                raise Failure('deployment_not_started')
            write_json(journal, {'state': 'running', 'image': request['image']})
            try:
                result = pull(request, base, fd)
            except Failure as error:
                result = {'error': str(error), 'pulled': error.pulled, 'deployed': False}
            except Exception:
                result = {'error': 'deployment_outcome_unknown', 'pulled': False, 'deployed': False}
            write_json(journal, {'state': 'finished', 'image': request['image'], 'result': result})
            return result
        if request.get('action') == 'pull':
            return pull(request, base, fd)
        raise Failure('invalid_request')
    finally:
        os.close(fd)

def main():
    try:
        raw = sys.stdin.buffer.read(65537)
        if len(raw) > 65536:
            raise Failure('invalid_request')
        if os.geteuid() != 0:
            raise Failure('root_required')
        result = run(json.loads(raw))
    except Failure as error:
        result = {'error': str(error), 'pulled': error.pulled, 'deployed': False}
    except subprocess.TimeoutExpired:
        result = {'error': 'remote_timeout'}
    except Exception:
        # Neither exception text, input nor docker login output may leave this process.
        result = {'error': 'registry_operation_failed'}
    print(json.dumps(result, separators=(',', ':')))
    return 1 if 'error' in result else 0

if __name__ == '__main__':
    sys.exit(main())
