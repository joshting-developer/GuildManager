// Light/sepia/dark choice is a per-viewer convenience kept in this browser only (default light).
// 米黃 (sepia) is a warm, low-glare light theme for long reading, like e-book readers.
const STORAGE_KEY = 'guild-theme';
export const THEMES = ['light', 'sepia', 'dark'];
export const VUETIFY_THEMES = { light: 'guild', sepia: 'guildSepia', dark: 'guildDark' };
export const THEME_LABELS = { light: '淺色', sepia: '米黃', dark: '深色' };

export function readTheme() {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    return THEMES.includes(saved) ? saved : 'light';
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
  root.style.colorScheme = name === 'dark' ? 'dark' : 'light';
}

// Text size is another per-viewer convenience. The stylesheet is in px, so the whole page is
// scaled with CSS zoom (menus and dialogs included) instead of changing the root font size.
const SCALE_KEY = 'guild-font-scale';
export const FONT_SCALES = { normal: 1, large: 1.1, larger: 1.25 };
export const FONT_SCALE_LABELS = { normal: '標準', large: '大', larger: '特大' };
const SCALE_ORDER = Object.keys(FONT_SCALES);

export function readFontScale() {
  try {
    const saved = globalThis.localStorage?.getItem(SCALE_KEY);
    return SCALE_ORDER.includes(saved) ? saved : 'normal';
  } catch {
    return 'normal';
  }
}

export function saveFontScale(name) {
  try {
    globalThis.localStorage?.setItem(SCALE_KEY, name);
  } catch {}
}

export function applyFontScale(name) {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  root.style.zoom = FONT_SCALES[name] === 1 ? '' : String(FONT_SCALES[name]);
}
