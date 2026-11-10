import base64
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('login', Path(__file__).parents[1] / 'scripts/login.py')
login = importlib.util.module_from_spec(spec)
spec.loader.exec_module(login)


class LoginTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        login.CONFIG = self.root / 'application-server/docker'
        login.LOCK = self.root / 'lock-dir'
        self.request = {'operation': 'prepare', 'registry': 'registry.invalid', 'username': 'puller', 'password': 'first-password'}
        self.calls = []

    def docker(self, args, **options):
        self.calls.append((args, options))
        if 'login' in args:
            self.assertNotIn(self.request['password'], ' '.join(args))
            self.assertEqual(options['input'], (self.request['password'] + '\n').encode())
            self.assertEqual(options['stdout'], subprocess.DEVNULL)
            self.assertEqual(options['stderr'], subprocess.DEVNULL)
            config = Path(args[args.index('--config') + 1]) / 'config.json'
            # Docker's helper autodetection must see an existing auth entry.
            self.assertEqual(json.loads(config.read_text()), {'auths': {'registry.invalid': {}}})
            auth = base64.b64encode(('puller:' + self.request['password']).encode()).decode()
            config.write_text(json.dumps({'auths': {'registry.invalid': {'auth': auth}}}))
        return subprocess.CompletedProcess(args, 0)

    def test_login_is_atomic_private_and_explicit_refresh_uses_new_password(self):
        with patch.object(login.subprocess, 'run', self.docker):
            login.configure(self.request)
            original = (login.CONFIG / 'config.json').read_text()
            self.assertEqual(login.CONFIG.stat().st_mode & 0o777, 0o700)
            self.assertEqual((login.CONFIG / 'config.json').stat().st_mode & 0o777, 0o600)
            self.request['password'] = 'rotated-password'
            login.configure(self.request)
            self.assertNotEqual((login.CONFIG / 'config.json').read_text(), original)
        self.assertEqual(len([args for args, _ in self.calls if 'login' in args]), 2)
        self.assertEqual(list(login.CONFIG.parent.glob('.login-*')), [])

    def test_bad_password_preserves_previous_config(self):
        with patch.object(login.subprocess, 'run', self.docker):
            login.configure(self.request)
        original = (login.CONFIG / 'config.json').read_bytes()
        def fail_login(args, **options):
            return subprocess.CompletedProcess(args, 1 if 'login' in args else 0)
        with patch.object(login.subprocess, 'run', fail_login):
            with self.assertRaisesRegex(RuntimeError, 'login_failed'):
                login.configure(self.request)
        self.assertEqual((login.CONFIG / 'config.json').read_bytes(), original)
        self.assertEqual(list(login.CONFIG.parent.glob('.login-*')), [])

    def test_unready_runtime_does_not_receive_credentials(self):
        with patch.object(login.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1)) as run:
            with self.assertRaisesRegex(RuntimeError, 'runtime_not_ready'):
                login.configure(self.request)
        self.assertEqual(run.call_count, 1)
        self.assertFalse(login.CONFIG.exists())

    def test_remove_only_our_config_and_obeys_shared_execution_lock(self):
        with patch.object(login.subprocess, 'run', self.docker):
            login.configure(self.request)
        unrelated = self.root / '.docker/config.json'
        unrelated.parent.mkdir()
        unrelated.write_text('keep-me')
        with (login.LOCK / 'lock').open('r+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                login.configure({'operation': 'remove'})
        self.assertTrue((login.CONFIG / 'config.json').exists())
        login.configure({'operation': 'remove'})
        login.configure({'operation': 'remove'})
        self.assertFalse((login.CONFIG / 'config.json').exists())
        self.assertEqual(unrelated.read_text(), 'keep-me')

    def test_symlink_directory_is_rejected(self):
        login.CONFIG.parent.mkdir(parents=True)
        login.CONFIG.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'unsafe_path'):
            login.configure({'operation': 'remove'})


if __name__ == '__main__':
    unittest.main()
