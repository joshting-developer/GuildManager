import { validatePlatformIcon } from '../domain/platform-settings.js';

// Only public branding belongs here; cached revisions never authorize a write.
export function normalizeCachedPlatform(value) {
  if (
    typeof value?.name !== 'string' ||
    !value.name.trim() ||
    [...value.name].length > 30 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value.name) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1
  )
    return null;
  if (value.iconSrc != null) {
    if (typeof value.iconSrc !== 'string') return null;
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.*)$/.exec(value.iconSrc);
    try {
      if (!match) return null;
      validatePlatformIcon({ mimeType: match[1], base64: match[2] });
    } catch {
      return null;
    }
  }
  return { name: value.name, iconSrc: value.iconSrc || null, revision: value.revision };
}

export function createPlatformCache({ source, namespace, storage } = {}) {
  const key = source === 'local'
    ? 'guild-platform:v1:local'
    : source === 'gas' && typeof namespace === 'string' && namespace
      ? `guild-platform:v1:gas:${namespace}`
      : null;
  function getStorage() {
    return storage === undefined ? globalThis.localStorage : storage;
  }
  return {
    read() {
      if (!key) return null;
      try {
        const raw = getStorage()?.getItem(key);
        if (!raw) return null;
        const platform = raw.length <= 360 * 1024
          ? normalizeCachedPlatform(JSON.parse(raw))
          : null;
        if (!platform) getStorage()?.removeItem(key);
        return platform;
      } catch {
        return null;
      }
    },
    write(value) {
      const platform = normalizeCachedPlatform(value);
      if (!key || !platform) return false;
      try {
        const target = getStorage();
        if (!target) return false;
        target.setItem(key, JSON.stringify(platform));
        return true;
      } catch {
        return false;
      }
    },
  };
}
