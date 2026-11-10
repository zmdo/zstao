#!/usr/bin/env python3
"""One application's detached Compose deployment and durable release records."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def require(condition, code):
    if not condition:
        raise ValueError(code)


def read(path):
    require(path.stat().st_size <= 1024 * 1024, 'json_too_large')
    return json.loads(path.read_text())


def write(path, value):
    temporary = path.with_name(path.name + '.tmp-' + str(os.getpid()))
    with temporary.open('w') as output:
        os.chmod(temporary, 0o600)
        json.dump(value, output, ensure_ascii=False)
        output.write('\n')
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def slug(value):
    require(isinstance(value, str) and re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,63}', value), 'invalid_identifier')
    return value


def child(root, relative):
    path = Path(relative)
    require(not path.is_absolute() and '..' not in path.parts, 'invalid_snapshot_path')
    result = root / path
    require(not result.is_symlink() and result.is_file() and result.resolve().is_relative_to(root.resolve()), 'snapshot_file_missing_or_symlink')
    return result


def boot_id():
    path = Path('/proc/sys/kernel/random/boot_id')
    return path.read_text().strip() if path.exists() else 'unknown'


def status(root, release):
    folder = root / 'releases' / slug(release)
    result = read(folder / 'status.json')
    if result['state'] in ('starting', 'running'):
        pid = result.get('pid')
        alive = False
        if pid and result.get('bootId') == boot_id():
            try:
                command = Path('/proc', str(pid), 'cmdline').read_bytes().split(b'\0')
                alive = b'_worker' in command and str(folder).encode() in command
            except (FileNotFoundError, ProcessLookupError):
                alive = False
        if not alive:
            result = {**result, 'state': 'needs_verification', 'error': 'deployment_process_unavailable'}
    return result


def prepare(root, release, request, source):
    slug(release)
    require(isinstance(request, dict), 'invalid_request')
    config = read(child(source, 'deploy/project.json'))
    application = slug(config['application'])
    require(config.get('version') == 1, 'unsupported_config_version')
    target = config['target']
    require(Path(target['directory']).is_absolute() and Path(target['directory']).resolve() == root, 'target_directory_mismatch')
    require(root != Path('/') and not root.is_symlink(), 'invalid_application_root')
    require(isinstance(request.get('commit'), str) and re.fullmatch(r'[a-f0-9]{40}', request['commit']), 'invalid_commit')
    require(type(request.get('buildId')) is int and request['buildId'] > 0, 'invalid_build_id')
    image = request.get('image', '')
    repository = config['imageRepository']
    require(re.fullmatch(r'[a-z0-9.-]+(?::\d+)?/[a-z0-9._/-]+', repository), 'invalid_image_repository')
    require(re.fullmatch(re.escape(repository) + r'@sha256:[a-f0-9]{64}', image), 'image_repository_or_digest_mismatch')
    require(request.get('serverId') == target['serverId'], 'target_server_mismatch')
    require(Path(target['envFile']).is_absolute(), 'env_file_must_be_absolute')
    require(Path(target['envFile']).is_file(), 'environment_file_missing')
    require(isinstance(target['healthUrl'], str) and target['healthUrl'].startswith(('http://', 'https://')), 'invalid_health_url')
    require(re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*', config['service']), 'invalid_compose_service')
    files = ['deploy/project.json', 'deploy/runtime.sh', 'deploy/runtime.py', config['composeFile']]
    hashes = {name: hashlib.sha256(child(source, name).read_bytes()).hexdigest() for name in files}
    identity = {**request, 'application': application, 'project': config['project'], 'environment': target['environment'],
                'releaseId': release, 'snapshot': hashes}
    return config, identity, files


def start(root, release, request, source):
    config, identity, files = prepare(root, release, request, source)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    releases = root / 'releases'
    releases.mkdir(exist_ok=True, mode=0o700)
    folder = releases / release
    lock = (root / 'deploy.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        if (folder / 'request.json').exists() and read(folder / 'request.json') == identity:
            return status(root, release)
        raise ValueError('another_deployment_running')
    try:
        if folder.exists():
            require((folder / 'request.json').exists() and read(folder / 'request.json') == identity, 'release_id_conflict')
            return status(root, release)
        if (root / 'active.json').exists():
            active = read(root / 'active.json')
            require(status(root, active['releaseId'])['state'] in ('succeeded', 'failed'), 'previous_deployment_needs_verification')
        folder.mkdir(mode=0o700)
        for name in files:
            destination = folder / 'snapshot' / name
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copyfile(child(source, name), destination)
            destination.chmod(0o600)
        write(folder / 'request.json', identity)
        previous = read(root / 'current.json') if (root / 'current.json').exists() else None
        write(folder / 'previous.json', previous)
        initial = {**identity, 'state': 'starting', 'phase': 'queued', 'startedAt': now(), 'bootId': boot_id()}
        write(folder / 'status.json', initial)
        write(root / 'active.json', {'releaseId': release})
        with (folder / 'deploy.log').open('ab') as log:
            os.chmod(folder / 'deploy.log', 0o600)
            worker = subprocess.Popen([sys.executable, str(folder / 'snapshot/deploy/runtime.py'), '_worker',
                                       str(folder), str(lock.fileno())], stdin=subprocess.DEVNULL,
                                      stdout=log, stderr=log, start_new_session=True, close_fds=True,
                                      pass_fds=(lock.fileno(),))
        # Worker waits for this marker before updating the status, avoiding a launch race.
        write(folder / 'status.json', {**initial, 'pid': worker.pid})
        (folder / 'launched').touch(mode=0o600)
        return {**initial, 'pid': worker.pid}
    finally:
        # The detached worker inherits this open file description and owns the lock.
        lock.close()


def worker(folder, lock_fd):
    for _ in range(100):
        if (folder / 'launched').exists():
            break
        time.sleep(0.05)
    root = folder.parent.parent
    state = read(folder / 'status.json')
    request = read(folder / 'request.json')
    config = read(folder / 'snapshot/deploy/project.json')
    target = config['target']
    env = {**os.environ, 'CES_IMAGE': request['image'], 'APP_ENV_FILE': target['envFile']}
    docker = ['docker', '--config', '/var/lib/ces/application-server/docker']
    compose = docker + ['compose', '--project-name', 'ces-' + config['application'], '--env-file', target['envFile'],
                        '--file', str(folder / 'snapshot' / config['composeFile'])]

    def update(phase, **extra):
        state.update(phase=phase, **extra)
        write(folder / 'status.json', state)

    def run(args, capture=False, timeout=600):
        result = subprocess.run(args, env=env, stdout=subprocess.PIPE if capture else None,
                                stderr=subprocess.PIPE if capture else subprocess.STDOUT, timeout=timeout, text=True)
        require(result.returncode == 0, 'command_failed_' + state['phase'])
        return result.stdout.strip() if capture else ''

    try:
        update('validate', state='running')
        resolved = json.loads(run(compose + ['config', '--format', 'json'], capture=True))
        require(resolved['services'][config['service']]['image'] == request['image'], 'compose_image_mismatch')
        require(all('container_name' not in item for item in resolved['services'].values()), 'fixed_container_names_not_supported')
        update('pull')
        run(docker + ['pull', request['image']])
        image = json.loads(run(docker + ['image', 'inspect', request['image']], capture=True))[0]
        require(request['image'] in image.get('RepoDigests', []), 'pulled_digest_mismatch')
        update('apply')
        run(compose + ['up', '-d', '--no-build', '--pull', 'never'], timeout=300)
        update('verify')
        deadline = time.monotonic() + 120
        healthy = False
        while time.monotonic() < deadline:
            containers = run(compose + ['ps', '-q', config['service']], capture=True).splitlines()
            if containers:
                details = json.loads(run(docker + ['inspect', *containers], capture=True))
                matching = all(c['Image'] == image['Id'] and c['State']['Running'] and c['State'].get('Health', {}).get('Status', 'healthy') == 'healthy' for c in details)
                if matching:
                    try:
                        with urllib.request.urlopen(target['healthUrl'], timeout=5) as response:
                            healthy = response.status == 200
                    except (urllib.error.URLError, TimeoutError):
                        healthy = False
                    if healthy:
                        break
            time.sleep(2)
        require(healthy, 'health_or_image_verification_failed')
        update('complete', state='succeeded', finishedAt=now(), imageId=image['Id'], healthUrl=target['healthUrl'])
        write(root / 'current.json', state)
    except Exception as error:
        # Command output goes to the release log; never serialize environment values.
        code = str(error) if isinstance(error, ValueError) else type(error).__name__
        update(state['phase'], state='failed', error=code, finishedAt=now())
        print(json.dumps({'releaseId': request['releaseId'], 'phase': state['phase'], 'error': code}), flush=True)
    finally:
        os.close(lock_fd)


def main():
    if len(sys.argv) == 4 and sys.argv[1] == '_worker':
        worker(Path(sys.argv[2]), int(sys.argv[3]))
        return
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['start', 'status', 'logs', 'rollback'])
    parser.add_argument('--root', required=True)
    parser.add_argument('--release', required=True)
    parser.add_argument('--request')
    parser.add_argument('--snapshot')
    parser.add_argument('--from-release')
    parser.add_argument('--offset', type=int, default=0)
    args = parser.parse_args()
    root = Path(args.root).resolve()
    slug(args.release)
    if args.action == 'start':
        require(args.request and args.snapshot, 'request_and_snapshot_required')
        result = start(root, args.release, read(Path(args.request)), Path(args.snapshot).resolve())
    elif args.action == 'status':
        result = status(root, args.release)
    elif args.action == 'logs':
        require(args.offset >= 0, 'invalid_offset')
        with (root / 'releases' / args.release / 'deploy.log').open('rb') as log:
            log.seek(args.offset)
            chunk = log.read(65536)
            result = {'releaseId': args.release, 'text': chunk.decode('utf-8', errors='replace'), 'nextOffset': log.tell()}
    else:
        previous = root / 'releases' / slug(args.from_release)
        require(read(previous / 'status.json')['state'] == 'succeeded', 'rollback_requires_successful_release')
        request = read(previous / 'request.json')
        for key in ['releaseId', 'snapshot']:
            request.pop(key, None)
        request['rollbackOf'] = args.from_release
        result = start(root, args.release, request, previous / 'snapshot')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) else type(error).__name__
        print(json.dumps({'error': code}), file=sys.stderr)
        sys.exit(1)
