// Light/dark choice is a per-viewer convenience kept in this browser only (default light).
const STORAGE_KEY = 'guild-theme';
export const VUETIFY_THEMES = { light: 'guild', dark: 'guildDark' };

export function readTheme() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function saveTheme(name) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, name);
  } catch {}
}

// CSS tokens in styles.css key off data-theme; color-scheme fixes native controls and scrollbars.
export function applyDocumentTheme(name) {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  root.dataset.theme = name;
  root.style.colorScheme = name;
}
