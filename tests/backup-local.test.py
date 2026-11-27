import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('local_backup', Path(__file__).resolve().parents[1] / 'tools/backup-local.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupSafetyTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=backup.ROOT / '.local')
        self.addCleanup(self.directory.cleanup)
        self.folder = Path(self.directory.name)
        self.snapshot = self.folder / 'snapshot.sql'
        self.snapshot.write_text('CREATE TABLE safe_table (id INT);\n')
        Path(str(self.snapshot) + '.json').write_text(json.dumps({'format': 'guildmanager-local-sql-v1', 'sha256': hashlib.sha256(self.snapshot.read_bytes()).hexdigest()}))
        self.config = {'purpose': 'guildmanager-local-backup', 'container': 'example-local-mysql', 'environment': {'DB_HOST': '127.0.0.1', 'DB_PORT': '13306', 'DB_SSL_MODE': 'disabled', 'DB_DATABASE': 'sp_guildmanager_codex_restoretest', 'DB_USERNAME': 'example_user', 'DB_PASSWORD': 'synthetic_password'}}
        self.configuration = self.folder / 'config.json'

    def restore(self):
        self.configuration.write_text(json.dumps(self.config))
        self.configuration.chmod(0o600)
        return patch('sys.argv', ['backup-local.py', 'restore', '--config', str(self.configuration), '--file', str(self.snapshot)])

    def test_nonempty_target_never_receives_restore_sql(self):
        with self.restore(), patch.object(backup, 'client', return_value=b'1\n') as client:
            with self.assertRaisesRegex(ValueError, 'empty'):
                backup.main()
            self.assertEqual(client.call_count, 1)
            self.assertIn(b'SELECT COUNT', client.call_args.args[3])

    def test_daily_and_remote_targets_rejected_before_any_client_io(self):
        for changes in [{'DB_DATABASE': 'sp_guildmanager_local_preview'}, {'DB_DATABASE': 'sp_guildmanager_local_dev'}, {'DB_HOST': 'example.test'}, {'DB_USERNAME': 'root'}]:
            original = self.config['environment'].copy()
            self.config['environment'].update(changes)
            with self.restore(), patch.object(backup, 'client') as client:
                with self.assertRaises(ValueError):
                    backup.main()
                client.assert_not_called()
            self.config['environment'] = original

    def test_preview_backup_accepted_but_other_preview_targets_rejected(self):
        for schema, accepted in [('sp_guildmanager_local_preview', True), ('sp_guildmanager_other_preview', False), ('sp_guildmanager_production', False)]:
            self.config['environment']['DB_DATABASE'] = schema
            self.configuration.write_text(json.dumps(self.config))
            self.configuration.chmod(0o600)
            target = self.folder / (schema + '.sql')
            with patch('sys.argv', ['backup-local.py', 'backup', '--config', str(self.configuration), '--file', str(target)]), patch.object(backup, 'dump') as dump:
                if accepted:
                    backup.main()
                    dump.assert_called_once()
                else:
                    with self.assertRaises(ValueError):
                        backup.main()
                    dump.assert_not_called()

    def test_corrupt_snapshot_rejected_before_any_client_io(self):
        self.snapshot.write_text('corrupt backup')
        with self.restore(), patch.object(backup, 'client') as client:
            with self.assertRaisesRegex(ValueError, 'checksum'):
                backup.main()
            client.assert_not_called()

    def test_logical_normalization_preserves_data_and_collation_changes(self):
        a, b = self.folder / 'a', self.folder / 'b'
        a.write_text('  `name` varchar(64) COLLATE utf8mb4_bin,\nINSERT INTO t VALUES (\'CHARACTER SET utf8mb4\');\n')
        b.write_text(a.read_text().replace('varchar(64) COLLATE', 'varchar(64) CHARACTER SET utf8mb4 COLLATE'))
        self.assertEqual(backup.logical_digest(a), backup.logical_digest(b))
        b.write_text(b.read_text().replace('utf8mb4_bin', 'utf8mb4_0900_ai_ci'))
        self.assertNotEqual(backup.logical_digest(a), backup.logical_digest(b))
        with self.assertRaises(ValueError):
            backup.private_path(backup.ROOT / 'public-snapshot.sql')


if __name__ == '__main__':
    unittest.main()
