"""Validate private deployment configuration without logging its contents."""
import os
from pathlib import Path
import re
import sys
import tomllib


def prepare(config, image, folder):
    data = tomllib.loads(config)
    app = data.get('app', '')
    env = data.get('env', {})
    service = data.get('http_service', {})
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]', app):
        raise ValueError('Invalid app')
    if env.get('NODE_ENV') != 'production' or env.get('DB_SSL_MODE') != 'verify_identity':
        raise ValueError('Production TLS required')
    if service.get('internal_port') != 3001 or service.get('force_https') is not True:
        raise ValueError('HTTPS service required')
    if data.get('deploy', {}).get('release_command') or data.get('files'):
        raise ValueError('Initialization and file injection require a separate procedure')
    if any(re.search(r'PASSWORD|SECRET|TOKEN|ACCESS_KEY|USERNAME|SSL_CA', key, re.I) for key in env):
        raise ValueError('Credentials belong in Fly Secrets')
    if image and not re.fullmatch(r'registry\.fly\.io/' + re.escape(app) + r'@sha256:[a-f0-9]{64}', image):
        raise ValueError('Rollback requires this app image digest')
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / 'fly.toml'
    with open(target, 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as handle:
        handle.write(config)
    return target


if __name__ == '__main__':
    try:
        prepare(os.environ['FLY_DEPLOY_CONFIG'], os.environ.get('DEPLOY_IMAGE', ''), os.environ['GITHUB_WORKSPACE'])
    except (KeyError, ValueError, TypeError, AttributeError, OSError):
        print('Deployment configuration rejected; private details withheld', file=sys.stderr)
        sys.exit(1)
