import importlib.util
from pathlib import Path
import stat
import os
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).resolve().parents[1] / 'tools/prepare-fly-deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
CONFIG = '''app="example-guild"
[env]
NODE_ENV="production"
DB_SSL_MODE="verify_identity"
[http_service]
internal_port=3001
force_https=true
'''


class DeployTest(unittest.TestCase):
    def test_private_file_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            target = deploy.prepare(CONFIG, '', folder)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            self.assertEqual(target.read_text(), CONFIG)
            with self.assertRaises(FileExistsError):
                deploy.prepare(CONFIG, '', folder)

    def test_rejects_unsafe_config_before_writing(self):
        variants = [CONFIG.replace('verify_identity', 'disabled'), CONFIG.replace('force_https=true', 'force_https=false'), CONFIG.replace('[http_service]', 'DB_PASSWORD="secret"\n[http_service]'), CONFIG + '\n[deploy]\nrelease_command="reset"\n']
        for config in variants:
            with self.subTest(config=config), tempfile.TemporaryDirectory() as folder:
                with self.assertRaises(ValueError):
                    deploy.prepare(config, '', folder)
                self.assertFalse((Path(folder) / 'fly.toml').exists())

    def test_invalid_secret_is_not_logged(self):
        marker = 'private-value-never-log'
        with tempfile.TemporaryDirectory() as folder:
            result = subprocess.run([sys.executable, str(spec.origin)], env={**os.environ, 'FLY_DEPLOY_CONFIG': marker, 'GITHUB_WORKSPACE': folder}, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(marker, result.stdout + result.stderr)
            self.assertNotIn('Traceback', result.stderr)

    def test_rollback_only_same_app_digest(self):
        with tempfile.TemporaryDirectory() as folder:
            deploy.prepare(CONFIG, 'registry.fly.io/example-guild@sha256:' + 'a' * 64, folder)
        for image in ['registry.fly.io/other@sha256:' + 'a' * 64, 'registry.fly.io/example-guild:latest', '$(echo unsafe)']:
            with tempfile.TemporaryDirectory() as folder:
                with self.assertRaises(ValueError):
                    deploy.prepare(CONFIG, image, folder)


if __name__ == '__main__':
    unittest.main()
