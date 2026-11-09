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

spec = importlib.util.spec_from_file_location('registry', Path(__file__).parents[1] / 'scripts/registry.py')
registry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(registry)

class RegistryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        registry.CES_SOURCE = ''
        registry.ROOT = self.root / 'configs'
        registry.LOCK_ROOT = self.root / 'management'
        registry.HELPER = self.root / 'ces-registry'
        self.logins = 0
        self.pulls = 0
        self.installs = 0
        self.fail_login = False
        self.pull_error = ''
        self.request = dict(action='prepare', credentialId='platform-pull', revision=1, sequence='1', fence='1', operationId='operation-1', serverId='server-1', configRevision='1', registry='registry.example', repositories=['team/*'])
        self.patch = patch.object(registry.subprocess, 'run', side_effect=self.docker)
        self.patch.start(); self.addCleanup(self.patch.stop)
    def docker(self, args, **kwargs):
        if 'login' in args:
            self.logins += 1
            self.assertNotIn(kwargs['input'].decode().strip(), args)
            secret = kwargs['input'].decode().strip()
            if self.fail_login:
                return subprocess.CompletedProcess(args, 1)
            config = Path(args[2]) / 'config.json'
            config.write_text(json.dumps({'auths': {'registry.example': {'auth': base64.b64encode(('pull:' + secret).encode()).decode()}}}))
        elif 'pull' in args:
            self.pulls += 1
            if self.pull_error:
                return subprocess.CompletedProcess(args, 1, stderr=self.pull_error.encode())
        else:
            self.installs += 1
        return subprocess.CompletedProcess(args, 0, stderr=b'')
    def prepare(self, **changes):
        return registry.run(self.request | changes)
    def install(self, **changes):
        result = self.prepare(**changes)
        if result.get('needsCredentials'):
            result = self.prepare(password='password', username='pull', **changes)
        return result
    def pull(self, receipt, **changes):
        return registry.run(dict(action='pull', image='registry.example/team/app@sha256:'+'a'*64, receipt=receipt, operationId='deploy-1') | changes)
    def test_first_repeat_rotation_and_old_fence(self):
        first = self.install()
        config = registry.ROOT / 'platform-pull/current/config.json'
        content = config.read_bytes()
        stamp = config.stat().st_mtime_ns
        second = self.install(sequence='2', operationId='operation-2')
        self.assertTrue(second['reused']); self.assertEqual(first['receipt'], second['receipt'])
        self.assertEqual(self.logins, 1); self.assertEqual(stamp, config.stat().st_mtime_ns)
        self.pull(second['receipt'])
        third = self.install(sequence='3', revision=2, operationId='operation-3')
        self.assertEqual(self.logins, 2)
        with self.assertRaisesRegex(registry.Failure, 'superseded'):
            self.prepare(sequence='2', fence='9', password='old-password')
        with self.assertRaisesRegex(registry.Failure, 'credential_receipt_stale'):
            self.pull(first['receipt'])
        self.pull(third['receipt']); self.assertEqual(self.pulls, 2)
        self.assertEqual(config.stat().st_mode & 0o777, 0o600)
        self.assertEqual(len(list((registry.ROOT / 'platform-pull/generations').iterdir())), 1)
    def test_missing_corrupt_and_lost_response_recovery(self):
        first = self.install()
        again = self.install(fence='2')
        self.assertEqual(first['receipt'], again['receipt']); self.assertEqual(self.logins, 1)
        config = registry.ROOT / 'platform-pull/current/config.json'
        config.unlink()
        self.install(sequence='2', operationId='operation-2'); self.assertEqual(self.logins, 2)
        config.write_text('{broken')
        self.install(sequence='3', operationId='operation-3'); self.assertEqual(self.logins, 3)
        with self.assertRaisesRegex(registry.Failure, 'superseded'):
            self.prepare(sequence='3', fence='0', operationId='operation-3')
    def test_invalid_new_password_preserves_config_and_blocks_old_receipt(self):
        old = self.install()['receipt']
        path = registry.ROOT / 'platform-pull/current'
        target = os.readlink(path)
        self.fail_login = True
        with self.assertRaisesRegex(registry.Failure, 'registry_login_failed'):
            self.install(sequence='2', revision=2, operationId='operation-2')
        self.assertEqual(os.readlink(path), target)
        with self.assertRaisesRegex(registry.Failure, 'credential_receipt_stale'):
            self.pull(old)
    def test_scope_auth_and_network_failures_do_not_start_deployment(self):
        receipt = self.install()['receipt']
        with self.assertRaisesRegex(registry.Failure, 'image_scope_denied'):
            self.pull(receipt, image='registry.example/other/app@sha256:'+'a'*64)
        self.pull_error = 'unauthorized: sensitive upstream detail'
        self.assertEqual(self.pull(receipt, action='deploy')['error'], 'registry_auth_failed')
        self.pull_error = 'network timeout'
        self.assertEqual(self.pull(receipt, action='deploy', operationId='deploy-2')['error'], 'image_pull_failed')
        self.assertEqual(self.installs, 0)
    def test_shared_lock_and_cleanup_leave_other_config_untouched(self):
        first = self.install()
        other = registry.ROOT / 'another'; other.mkdir(); (other/'config.json').write_text('other config')
        fd = os.open(str(registry.LOCK_ROOT / 'lock'), os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(registry.Failure, 'server_busy'):
                self.pull(first['receipt'])
        finally:
            os.close(fd)
        self.prepare(action='remove', sequence='2', revision=2, operationId='cleanup')
        self.assertFalse((registry.ROOT / 'platform-pull/current').exists())
        self.assertEqual((other/'config.json').read_text(), 'other config')
        with self.assertRaisesRegex(registry.Failure, 'superseded'):
            self.prepare(password='old-password')
    def test_deployment_journal_recovers_without_replay(self):
        receipt = self.install()['receipt']
        runtime = self.root / 'runtime'; runtime.write_text('fixture')
        registry.RUNTIME = str(runtime)
        first = self.pull(receipt, action='deploy')
        self.assertTrue(first['deployed'])
        self.assertEqual(self.installs, 1)
        second = self.pull(receipt, action='deployment-status')
        self.assertEqual(first, second)
        self.pull(receipt, action='deploy')
        self.assertEqual(self.installs, 1)
        journal = registry.ROOT / 'platform-pull/deployments/deploy-1.json'
        record = json.loads(journal.read_text()); record['state'] = 'running'
        journal.write_text(json.dumps(record))
        with self.assertRaisesRegex(registry.Failure, 'deployment_outcome_unknown'):
            self.pull(receipt, action='deployment-status')
        self.assertEqual(self.installs, 1)
    def test_symlink_attack_is_refused(self):
        self.install()
        config = registry.ROOT / 'platform-pull/current/config.json'
        config.unlink(); config.symlink_to(self.root / 'outside')
        with self.assertRaisesRegex(registry.Failure, 'unsafe_path'):
            self.prepare(sequence='2')

if __name__ == '__main__':
    unittest.main()
