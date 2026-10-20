// Battle stats reach millions. A column whose values reach 10,000 is shown in 萬 with one
// decimal in every cell (1234567 → 123.5萬, 8000 → 0.8萬), so the whole column shares one
// unit and lines up. Zero and missing values read as a faint —.
export const WAN = 10000;

export function isWanColumn(values) {
  return values.some((value) => typeof value === 'number' && Math.abs(value) >= WAN);
}

// Returns the cell text, whether it is empty (rendered faint) and the exact value tooltip.
export function statCell(value, { wan = false, maximumFractionDigits = 0 } = {}) {
  if (value == null || value === '' || value === 0) return { text: '—', empty: true };
  if (typeof value !== 'number' || !Number.isFinite(value)) return { text: String(value), empty: false };
  const exact = value.toLocaleString('zh-TW', { maximumFractionDigits });
  if (!wan) return { text: exact, empty: false };
  // Below 0.1萬 one decimal would read as 0.0; say so instead and keep the exact tooltip.
  if (Math.abs(value) < WAN / 20)
    return { text: value < 0 ? '>-0.1萬' : '<0.1萬', empty: false, title: exact };
  const text = (value / WAN).toLocaleString('zh-TW', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return { text: `${text}萬`, empty: false, title: exact };
}

// Single large figures (team totals, gaps) read in 萬／億 with one decimal: 1720965125 → 17.2億.
export function compactStat(value) {
  if (value == null) return '—';
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  const unit = Math.abs(value) >= 1e8 ? [1e8, '億'] : Math.abs(value) >= WAN ? [WAN, '萬'] : null;
  if (!unit) return value.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
  return `${(value / unit[0]).toLocaleString('zh-TW', { maximumFractionDigits: 1 })}${unit[1]}`;
}
