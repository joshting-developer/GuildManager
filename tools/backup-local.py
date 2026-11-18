#!/usr/bin/env python3
"""Back up GM's local shared MySQL; restore only into an empty restoretest schema."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def private_path(value):
    path = Path(value).resolve()
    if not path.is_relative_to(ROOT / '.local'):
        raise ValueError('Files must remain under the private .local directory')
    return path


def client(config, program, extra=(), sql=None, output=None):
    env = config['environment']
    command = ['docker', 'exec', '-i', config['container'], 'sh', '-c',
               'IFS= read -r MYSQL_PWD; export MYSQL_PWD; exec "$@"', 'sh', program,
               '--protocol=TCP', '-h127.0.0.1', '-u' + env['DB_USERNAME'], '--default-character-set=utf8mb4',
               *extra, env['DB_DATABASE']]
    result = subprocess.run(command, input=(env['DB_PASSWORD'] + '\n').encode() + (sql or b''),
                            stdout=output or subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('Local MySQL operation failed; provider output withheld')
    return result.stdout


def dump(config, output):
    client(config, 'mysqldump', ['--single-transaction', '--no-tablespaces', '--set-gtid-purged=OFF',
                               '--hex-blob', '--order-by-primary', '--skip-comments', '--skip-add-drop-table'], output=output)


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def logical_digest(path):
    # MySQL re-emits an explicit column charset after restore; a utf8mb4 collation
    # already determines that charset. Normalize only this redundant DDL spelling.
    checksum = hashlib.sha256()
    with path.open('rb') as handle:
        for line in handle:
            if line.startswith(b'  `') and b' COLLATE utf8mb4_' in line:
                line = line.replace(b' CHARACTER SET utf8mb4 COLLATE utf8mb4_', b' COLLATE utf8mb4_')
            checksum.update(line)
    return checksum.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['backup', 'restore'])
    parser.add_argument('--config', required=True)
    parser.add_argument('--file')
    args = parser.parse_args()
    config_path = private_path(args.config)
    if config_path.stat().st_mode & 0o077:
        raise ValueError('Configuration must have mode 0600')
    config = json.loads(config_path.read_text())
    env = config['environment']
    if config.get('purpose') != 'guildmanager-local-backup' or not re.fullmatch(r'[a-zA-Z0-9_.-]+', config['container']):
        raise ValueError('Explicit local backup configuration required')
    if env.get('DB_HOST') != '127.0.0.1' or str(env.get('DB_PORT')) != '13306' or env.get('DB_SSL_MODE') != 'disabled':
        raise ValueError('Only the local shared MySQL configuration is accepted')
    if not re.fullmatch(r'sp_guildmanager_[a-z][a-z0-9]*_(dev|test|runtimetest|restoretest[0-9]*)', env['DB_DATABASE']):
        raise ValueError('Only dedicated GM local schemas are accepted')
    if env['DB_USERNAME'] == 'root' or not re.fullmatch(r'[a-zA-Z0-9_]+', env['DB_USERNAME']) or any(c in env['DB_PASSWORD'] for c in '\r\n\0'):
        raise ValueError('Use the dedicated schema account')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    target = private_path(args.file or ROOT / '.local/backups' / ('mysql-' + stamp + '.sql'))
    if args.operation == 'backup':
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as handle:
            dump(config, handle)
        manifest = {'format': 'guildmanager-local-sql-v1', 'sha256': digest(target), 'createdAt': stamp}
        with os.fdopen(os.open(str(target) + '.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as handle:
            json.dump(manifest, handle)
        print('Local MySQL snapshot saved:', target.relative_to(ROOT))
    else:
        if not args.file or not re.search(r'_restoretest[0-9]*$', env['DB_DATABASE']):
            raise ValueError('Restore requires an explicit snapshot and restoretest schema')
        manifest = json.loads(Path(str(target) + '.json').read_text())
        if manifest.get('format') != 'guildmanager-local-sql-v1' or digest(target) != manifest['sha256']:
            raise ValueError('Snapshot checksum mismatch')
        count = client(config, 'mysql', ['--batch', '--skip-column-names'], b'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE();\n')
        if count.strip() != b'0':
            raise ValueError('Restore target must be empty; existing tables will not be overwritten')
        client(config, 'mysql', ['--binary-mode=1'], target.read_bytes())
        verification = target.with_name(target.name + '.restored-' + stamp)
        try:
            with os.fdopen(os.open(verification, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as handle:
                dump(config, handle)
            if logical_digest(verification) != logical_digest(target):
                raise RuntimeError('Restore completed but logical dump differs; inspect the isolated target')
        finally:
            verification.unlink(missing_ok=True)
        print('Local restore verified by identical logical dump; existing source untouched')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, RuntimeError, json.JSONDecodeError) as error:
        print('Local backup failed:', str(error) if isinstance(error, (ValueError, RuntimeError)) else 'configuration or IO error', file=sys.stderr)
        sys.exit(1)
