#!/usr/bin/env python3
"""Configure only the CES application-server Docker directory; no request journal."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

CONFIG = Path('/var/lib/ces/application-server/docker')
LOCK = Path('/var/lib/smp-server-management')

def directory(path):
    if path.is_symlink():
        raise RuntimeError('unsafe_path')
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    if not path.is_dir() or path.stat().st_uid != os.geteuid():
        raise RuntimeError('unsafe_path')
    path.chmod(0o700)

def configure(request):
    directory(LOCK)
    fd = os.open(str(LOCK / 'lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if request['operation'] == 'remove':
            if CONFIG.is_symlink():
                raise RuntimeError('unsafe_path')
            if CONFIG.exists():
                # This directory is exclusively owned by this plugin, not a user's ~/.docker.
                (CONFIG / 'config.json').unlink(missing_ok=True)
            return
        if request['operation'] != 'prepare':
            raise RuntimeError('invalid_operation')
        # A successful registry login alone does not prove this is a usable host.
        for command in (['docker', 'info'], ['docker', 'compose', 'version']):
            if subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20, pass_fds=(fd,)).returncode:
                raise RuntimeError('runtime_not_ready')
        directory(CONFIG.parent)
        directory(CONFIG)
        temporary = Path(tempfile.mkdtemp(prefix='.login-', dir=str(CONFIG.parent)))
        try:
            # Avoid inheriting or auto-selecting a credential helper on the target host.
            (temporary / 'config.json').write_text(json.dumps({'auths': {request['registry']: {}}}))
            result = subprocess.run(['docker', '--config', str(temporary), 'login', request['registry'], '--username', request['username'], '--password-stdin'], input=(request['password'] + '\n').encode(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90, pass_fds=(fd,))
            if result.returncode:
                raise RuntimeError('login_failed')
            config = json.loads((temporary / 'config.json').read_text())
            if not config.get('auths', {}).get(request['registry'], {}).get('auth') or config.get('credsStore') or config.get('credHelpers'):
                raise RuntimeError('invalid_config')
            (temporary / 'config.json').chmod(0o600)
            with (temporary / 'config.json').open('rb') as saved:
                os.fsync(saved.fileno())
            os.replace(temporary / 'config.json', CONFIG / 'config.json')
        finally:
            shutil.rmtree(temporary)
    finally:
        os.close(fd)

def main():
    try:
        if os.geteuid() != 0:
            raise RuntimeError('root_required')
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384:
            raise RuntimeError('request_too_large')
        configure(json.loads(raw))
    except Exception:
        # Docker output, stdin and exceptions can contain credentials. Do not return them.
        print('{"ok":false}')
        return 1
    print('{"ok":true}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
