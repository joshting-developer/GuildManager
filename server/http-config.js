import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

export class HttpConfigurationError extends Error {
  constructor() {
    super('HTTP configuration is invalid');
    this.code = 'HTTP_CONFIGURATION';
  }
}

export function createHttpConfig(environment = process.env) {
  const production = environment.NODE_ENV === 'production';
  const origin = environment.APP_ORIGIN;
  if (production && !origin) throw new HttpConfigurationError();
  if (origin) {
    let url;
    try { url = new URL(origin); } catch { throw new HttpConfigurationError(); }
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || (production && url.protocol !== 'https:')) {
      throw new HttpConfigurationError();
    }
  }
  const trustProxy = environment.TRUSTED_PROXY_CIDRS ? environment.TRUSTED_PROXY_CIDRS.split(',').map((value) => value.trim()) : [];
  for (const entry of trustProxy) {
    const [ip, prefix, extra] = entry.split('/');
    const version = isIP(ip);
    if (!version || extra !== undefined || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128)))) {
      throw new HttpConfigurationError();
    }
  }
  return {
    allowedOrigins: origin ? [origin] : [5173, 5174, 4173].flatMap((port) => ['localhost', '127.0.0.1'].map((host) => `http://${host}:${port}`)),
    secureCookies: production,
    trustProxy: trustProxy.length ? trustProxy : false,
    staticDir: production ? fileURLToPath(new URL('../dist/', import.meta.url)) : null,
  };
}

export function assertStaticBuild(directory) {
  try {
    if (!statSync(resolve(directory, 'index.html')).isFile()) throw new Error();
  } catch { throw new HttpConfigurationError(); }
}
