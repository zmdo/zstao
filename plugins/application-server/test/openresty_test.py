import copy
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

SOURCE = (Path(__file__).parents[1] / 'scripts/openresty.sh').read_text().split("<<'PY'\n", 1)[1].split('\nPY\n', 1)[0]

class RecipeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.m = types.ModuleType('recipe')
        exec(compile(SOURCE, 'openresty.sh', 'exec'), self.m.__dict__)
        self.m.ROOT = Path(self.temp.name).resolve() / 'openresty'
        self.items, self.calls = {}, []
        self.fail_start = False
        self.cached = False
        self.m.run = self.run_command
        self.check_ports = self.m.require_free_ports
        self.m.require_free_ports = lambda: None
        self.m.check_listeners = lambda: None
        self.request = dict(contractVersion=2, software='@smp/console-application-server/openresty',
                            recipe=self.m.OWNER, recipeRevision='test', os=dict(architecture='x86_64'))
        self.which = patch.object(self.m.shutil, 'which', return_value='/usr/bin/docker')
        self.which.start()
        self.addCleanup(self.which.stop)

    def info(self, image, version):
        m = self.m
        return dict(Id='id-' + version, Image='image-' + image, State=dict(Running=False),
                    Config=dict(Image=image, Cmd=m.COMMAND, Entrypoint=[], Labels={m.LABEL+'owner':m.OWNER, m.LABEL+'version':version}),
                    HostConfig=dict(NetworkMode='host', RestartPolicy=dict(Name='unless-stopped')),
                    Mounts=[dict(Source=str(m.ROOT), Destination=m.MOUNT, RW=False)])

    def find(self, name):
        for key, value in self.items.items():
            if key == name or value['Id'] == name:
                return key, value
        raise AssertionError('Unknown container ' + name)

    def run_command(self, args, timeout=30):
        self.calls.append(args)
        self.assertEqual(args[0], 'docker')
        args = args[1:]
        if args[:2] == ['container', 'ls']:
            return '\n'.join(self.items)
        if args[:2] == ['container', 'inspect']:
            return json.dumps([self.find(args[2])[1]])
        if args[:2] == ['image', 'inspect']:
            return json.dumps([dict(Id='image-' + args[2], Architecture='amd64')])
        if args[:2] == ['image', 'ls']:
            return 'openresty/openresty@' + self.m.DIGEST if self.cached else ''
        if args[0] == 'create':
            info = self.info(self.m.IMAGE, self.m.VERSION)
            self.items[self.m.NAME] = info
            return info['Id']
        if args[0] == 'rename':
            self.items[args[2]] = self.items.pop(args[1])
        elif args[0] in ('start', 'stop'):
            key, info = self.find(args[-1])
            if args[0] == 'start' and self.fail_start and info['Config']['Image'] == self.m.IMAGE:
                raise self.m.Failure('test_start_failed')
            info['State']['Running'] = args[0] == 'start'
        elif args[0] == 'rm':
            key, _ = self.find(args[-1])
            del self.items[key]
        elif args[0] == 'exec':
            _, info = self.find(args[1])
            if args[2] == 'sh':
                return 'nginx version: openresty/' + info['Config']['Labels'][self.m.LABEL+'version']
        elif args[0] not in ('pull', 'run'):
            raise AssertionError(args)
        return ''

    def request_for(self, operation, **extra):
        return dict(self.request, operation=operation, **extra)

    def change(self, action='install'):
        m = self.m
        return m.handle(self.request_for('resolve', target=m.candidate('x86_64'), installed=m.detect(), action=action))['change']

    def execute(self, change):
        return self.m.handle(self.request_for('execute', change=change))

    def test_plan_without_docker_and_frozen_image(self):
        with patch.object(self.m.shutil, 'which', return_value=None):
            self.assertEqual(self.m.detect(), dict(state='missing'))
            change = self.change()
        self.assertEqual(self.calls, [])
        self.assertIn('@sha256:', change['payload']['image'])
        change['payload']['image'] = 'openresty/openresty:latest'
        with self.assertRaisesRegex(self.m.Failure, 'plan_changed'):
            self.execute(change)
        self.assertFalse(self.m.ROOT.exists())

    def test_install_idempotency_and_preserved_sites(self):
        change = self.change()
        self.assertEqual(self.execute(change)['state'], 'completed')
        self.assertTrue(self.m.detect()['healthy'])
        site = self.m.ROOT / 'sites' / 'existing.conf'
        site.write_text('# existing website\n')
        self.calls.clear()
        self.assertEqual(self.execute(change)['changes'], [])
        self.assertFalse(any(call[1] in ('pull', 'create', 'stop', 'rm') for call in self.calls))
        self.assertEqual(site.read_text(), '# existing website\n')
        self.assertIn('listen 0.0.0.0:80 default_server', self.m.CONFIG)
        self.assertIn('listen 0.0.0.0:443 ssl default_server', self.m.CONFIG)
        self.assertIn('ssl_reject_handshake on', self.m.CONFIG)

    def test_occupied_default_port_blocks_installation(self):
        with patch.object(self.m.socket, 'socket') as sock:
            sock.return_value.__enter__.return_value.bind.side_effect = OSError('occupied')
            self.m.require_free_ports = self.check_ports
            with self.assertRaisesRegex(self.m.Failure, 'gateway_port_in_use_80'):
                self.change()
        self.assertFalse(self.m.ROOT.exists())

    def test_unmanaged_container_and_directory_refused(self):
        info = self.info(self.m.IMAGE, self.m.VERSION)
        info['Config']['Labels'] = {}
        self.items[self.m.NAME] = info
        with self.assertRaisesRegex(self.m.Failure, 'unmanaged_gateway_container'):
            self.m.detect()
        self.items.clear()
        self.m.ROOT.mkdir()
        with self.assertRaisesRegex(self.m.Failure, 'unmanaged_gateway_directory'):
            self.m.detect()

    def test_exact_cached_digest_does_not_contact_registry(self):
        self.cached = True
        self.execute(self.change())
        self.assertFalse(any(call[1] == 'pull' for call in self.calls))
        self.assertTrue(self.m.detect()['healthy'])

    def test_failed_replacement_restores_old_container_and_site(self):
        m = self.m
        m.prepare_root()
        site = m.ROOT / 'sites' / 'existing.conf'
        site.write_text('# keep this\n')
        old_image = m.IMAGE.replace('1.27.1.2', '1.27.1.1')
        old = self.info(old_image, '1.27.1.1')
        old['State']['Running'] = True
        self.items[m.NAME] = old
        change = self.change('replace')
        self.fail_start = True
        with self.assertRaisesRegex(m.Failure, 'test_start_failed'):
            self.execute(change)
        self.assertEqual(self.items[m.NAME]['Config']['Image'], old_image)
        self.assertTrue(self.items[m.NAME]['State']['Running'])
        self.assertEqual(list(self.items), [m.NAME])
        self.assertEqual(site.read_text(), '# keep this\n')

    def test_drift_and_interrupted_replacement_are_not_overwritten(self):
        change = self.change()
        self.execute(change)
        self.items[self.m.NAME]['HostConfig']['NetworkMode'] = 'bridge'
        with self.assertRaisesRegex(self.m.Failure, 'container_drift'):
            self.m.detect()
        self.items[self.m.NAME]['HostConfig']['NetworkMode'] = 'host'
        self.items[self.m.NAME + '-previous'] = copy.deepcopy(self.items[self.m.NAME])
        result = self.m.handle(self.request_for('recover', change=change))
        self.assertEqual(result['state'], 'unknown')

    def test_symlink_root_refused(self):
        target = Path(self.temp.name) / 'other'
        target.mkdir()
        self.m.ROOT.symlink_to(target)
        with self.assertRaisesRegex(self.m.Failure, 'unsafe_gateway_path'):
            self.m.prepare_root()
        self.assertEqual(list(target.iterdir()), [])

if __name__ == '__main__':
    unittest.main()
