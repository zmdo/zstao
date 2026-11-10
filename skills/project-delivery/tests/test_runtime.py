import http.server
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest

TEMPLATES = Path(__file__).resolve().parents[1] / 'templates'
spec = importlib.util.spec_from_file_location('delivery_runtime', TEMPLATES / 'deploy/runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'ok')

    def log_message(self, *_args):
        pass


FAKE_DOCKER = r'''
import json,os,sys,time
from pathlib import Path
root=Path(os.environ['FAKE_DOCKER_ROOT']);args=sys.argv[1:]
with (root/'calls').open('a') as f:f.write(json.dumps(args)+'\n')
image=os.environ['CES_IMAGE']; image_id='sha256:'+image.split(':')[-1]
if 'compose' in args and 'config' in args:
 print(json.dumps({'services':{'web':{'image':image}}}))
elif 'pull' in args and 'compose' not in args:
 time.sleep(float(os.environ.get('FAKE_DOCKER_DELAY','0')))
 if (root/'fail-pull').exists():sys.exit(1)
elif 'image' in args and 'inspect' in args:
 print(json.dumps([{'Id':image_id,'RepoDigests':[image]}]))
elif 'compose' in args and 'up' in args:
 (root/'running-image').write_text(image_id)
elif 'compose' in args and 'ps' in args:print('test-container')
elif 'inspect' in args:
 print(json.dumps([{'Image':(root/'running-image').read_text(),'State':{'Running':True}}]))
'''


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.source = self.directory / 'source'
        shutil.copytree(TEMPLATES, self.source)
        self.root = self.directory / 'application'
        (self.root / 'shared').mkdir(parents=True)
        (self.root / 'shared/app.env').touch()
        self.http = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        config = json.loads((self.source / 'deploy/project.json').read_text())
        config['target'].update(directory=str(self.root), envFile=str(self.root / 'shared/app.env'), serverId='server-1',
                                healthUrl=f'http://127.0.0.1:{self.http.server_port}/health')
        (self.source / 'deploy/project.json').write_text(json.dumps(config))
        self.request = {'commit': 'a' * 40, 'buildId': 1, 'serverId': 'server-1', 'image': 'registry.example.com/team/demo@sha256:' + 'b' * 64}
        self.request_path = self.directory / 'request.json'
        self.request_path.write_text(json.dumps(self.request))
        (self.directory / 'docker').write_text('#!' + sys.executable + '\n' + FAKE_DOCKER)
        (self.directory / 'docker').chmod(0o700)
        self.env = {**os.environ, 'PATH': str(self.directory) + os.pathsep + os.environ['PATH'], 'FAKE_DOCKER_ROOT': str(self.directory)}

    def tearDown(self):
        self.http.shutdown()
        self.thread.join()
        self.http.server_close()
        self.temp.cleanup()

    def invoke(self, action, release, *extra):
        result = subprocess.run([sys.executable, str(self.source / 'deploy/runtime.py'), action, '--root', str(self.root), '--release', release, *extra], env=self.env, capture_output=True, text=True, timeout=5)
        return result.returncode, json.loads(result.stdout if result.returncode == 0 else result.stderr)

    def start(self, release):
        return self.invoke('start', release, '--request', str(self.request_path), '--snapshot', str(self.source))

    def wait(self, release):
        path = self.root / 'releases' / release / 'status.json'
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            value = json.loads(path.read_text())
            if value['state'] in ('succeeded', 'failed'):
                # Final status precedes current.json by one atomic write.
                time.sleep(0.05)
                return value
            time.sleep(0.03)
        self.fail('worker did not finish')

    def test_detached_deployment_idempotency_conflict_and_rollback(self):
        self.env['FAKE_DOCKER_DELAY'] = '0.6'
        code, started = self.start('release-1')
        self.assertEqual(code, 0)
        self.assertEqual(started['state'], 'starting')
        self.assertEqual(self.start('release-2')[1]['error'], 'another_deployment_running')
        self.assertEqual(self.wait('release-1')['state'], 'succeeded')
        calls = (self.directory / 'calls').read_text()
        self.assertEqual(self.start('release-1')[0], 0)
        self.assertEqual((self.directory / 'calls').read_text(), calls)
        self.request['image'] = 'registry.example.com/team/demo@sha256:' + 'c' * 64
        self.request_path.write_text(json.dumps(self.request))
        self.assertEqual(self.start('release-1')[1]['error'], 'release_id_conflict')
        self.assertEqual(self.start('release-2')[0], 0)
        self.assertEqual(self.wait('release-2')['state'], 'succeeded')
        self.assertEqual(self.invoke('rollback', 'rollback-3', '--from-release', 'release-1')[0], 0)
        self.assertEqual(self.wait('rollback-3')['image'], 'registry.example.com/team/demo@sha256:' + 'b' * 64)
        self.assertEqual(json.loads((self.root / 'current.json').read_text())['releaseId'], 'rollback-3')

    def test_pull_failure_preserves_current_and_does_not_apply(self):
        self.assertEqual(self.start('good')[0], 0)
        self.assertEqual(self.wait('good')['state'], 'succeeded')
        previous = (self.root / 'current.json').read_text()
        calls = (self.directory / 'calls').read_text()
        (self.directory / 'fail-pull').touch()
        self.assertEqual(self.start('failed')[0], 0)
        result = self.wait('failed')
        self.assertEqual((result['state'], result['phase']), ('failed', 'pull'))
        self.assertEqual((self.root / 'current.json').read_text(), previous)
        new_calls = (self.directory / 'calls').read_text()[len(calls):]
        self.assertNotIn('"up"', new_calls)

    def test_invalid_target_or_repository_does_not_create_release(self):
        self.request['image'] = 'registry.example.com/other/demo@sha256:' + 'b' * 64
        self.request_path.write_text(json.dumps(self.request))
        self.assertEqual(self.start('bad')[1]['error'], 'image_repository_or_digest_mismatch')
        self.assertFalse((self.root / 'releases').exists())

    def test_stale_running_record_requires_verification(self):
        folder = self.root / 'releases/stale'
        folder.mkdir(parents=True)
        (folder / 'status.json').write_text(json.dumps({'state': 'running', 'pid': 99999999, 'bootId': 'old'}))
        self.assertEqual(runtime.status(self.root, 'stale')['state'], 'needs_verification')
        (self.root / 'active.json').write_text(json.dumps({'releaseId': 'stale'}))
        self.assertEqual(self.start('new')[1]['error'], 'previous_deployment_needs_verification')
        self.assertFalse((self.root / 'releases/new').exists())


if __name__ == '__main__':
    unittest.main()
