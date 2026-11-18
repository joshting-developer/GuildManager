// Cleaning rules are pattern based so the same decisions replay on a newer export.
// Rationale for every rule lives in docs/legacy-import.md; keep ids stable once published.
export const CLEANING_RULES = {
  R1: { action: 'keep', title: "改名紀錄是遊戲佔位名 '同門'<UID>, 保留供戰績曾用名比對" },
  R2: { action: 'keep', title: '改名紀錄含目前名稱（改回原名）, 保留為真實歷史' },
  R3: { action: 'keep-if-used', title: '佔位 UID 成員（0 開頭補位）, 有被使用才保留' },
  R4: { action: 'keep-if-used', title: '名稱全為數字的外部報名, 有被使用才保留' },
  R5: { action: 'drop', title: '對不到現存資料的列, 捨棄' },
};

export const PLACEHOLDER_HISTORY_NAME = /^'同門'\d+$/;
export const PLACEHOLDER_UID = /^0{6,}\d{0,3}$/;
export const NUMERIC_NAME = /^\d{6,}$/;

export function createCleaningReport() {
  const hits = Object.fromEntries(Object.keys(CLEANING_RULES).map((id) => [id, []]));
  const anomalies = [];
  return {
    hits,
    anomalies,
    hit(rule, entry) {
      hits[rule].push(entry);
    },
    // Anything without a rule blocks the import until a decision is recorded.
    anomaly(table, key, message) {
      anomalies.push({ table, key, message });
    },
    summary() {
      return {
        rules: Object.fromEntries(Object.entries(CLEANING_RULES).map(([id, rule]) => [id, {
          ...rule,
          count: hits[id].length,
          kept: hits[id].filter((entry) => entry.kept).length,
          dropped: hits[id].filter((entry) => !entry.kept).length,
        }])),
        anomalies: anomalies.length,
      };
    },
  };
}
