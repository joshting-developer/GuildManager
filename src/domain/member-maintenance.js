import { MemberError, validateMember, validateRevision } from '../../server/member-validation.js';

export function maintenanceInput(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key)))
    throw new MemberError(422, 'VALIDATION_ERROR', '包含不支援的成員維護欄位');
  validateRevision(input.revision);
  if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.requestId))
    throw new MemberError(422, 'INVALID_REQUEST', '操作識別碼不正確，請重新操作');
  return input;
}

export function validateMemberMaintenance(input) {
  maintenanceInput(input, ['newUid', 'name', 'primaryProfessionId', 'secondaryProfessionId',
    'isInGuild', 'isInClub', 'revision', 'requestId']);
  const { newUid, requestId, ...profile } = input;
  const values = validateMember(profile, { editing: true });
  // Reuse the creation rules so IDs retain leading zeroes and remain text.
  const { revision, ...creation } = profile;
  const uid = validateMember({ ...creation, uid: newUid });
  return { ...values, newUid: uid.uid, requestId };
}

export function validateNameHistory(input, current) {
  maintenanceInput(input, ['entries', 'revision', 'requestId']);
  if (!Array.isArray(input.entries) || input.entries.length > 500)
    throw new MemberError(422, 'VALIDATION_ERROR', '過去名稱最多 500 筆');
  const ids = new Set();
  const names = new Set();
  const known = new Map(current.previousNames.map((entry) => [entry.id, entry]));
  return input.entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
      Object.keys(entry).some((key) => !['id', 'name'].includes(key)) ||
      typeof entry.name !== 'string' || !entry.name.trim() || entry.name.trim().length > 64 ||
      /[\u0000-\u001f\u007f]/.test(entry.name))
      throw new MemberError(422, 'VALIDATION_ERROR', '請填寫有效的過去名稱，最多 64 個字元');
    const name = entry.name.trim();
    if (entry.id !== undefined && (typeof entry.id !== 'string' || !known.has(entry.id) || ids.has(entry.id)))
      throw new MemberError(422, 'INVALID_HISTORY', '名稱紀錄不屬於這位成員或重複，請重新載入');
    // Existing automatic rename history may legitimately contain repeated names.
    const unchanged = entry.id && known.get(entry.id).name === name;
    if (!unchanged && (name === current.name || names.has(name) ||
      input.entries.some((other) => other !== entry && typeof other?.name === 'string' && other.name.trim() === name)))
      throw new MemberError(422, 'DUPLICATE_NAME', '過去名稱不可與現在名稱或其他過去名稱重複');
    if (entry.id) ids.add(entry.id);
    names.add(name);
    return { ...(entry.id ? { id: entry.id } : {}), name };
  });
}

// Overrides belong to one immutable record, never to a UID globally: reusing an
// old UID for a new person must not redirect that person's future snapshots.
export function projectMemberReferences(value, overrides = []) {
  const mapping = new Map(overrides);
  function visit(item) {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key,
      ['uid', 'memberUid'].includes(key) && mapping.has(child) ? mapping.get(child) : visit(child),
    ]));
  }
  return visit(value);
}

export function remapMemberReferences(value, overrides, fromUid, toUid) {
  const mapping = new Map(overrides);
  function visit(item) {
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      if (['uid', 'memberUid'].includes(key) && typeof child === 'string' &&
        (mapping.has(child) ? mapping.get(child) : child) === fromUid) mapping.set(child, toUid);
      else if (child && typeof child === 'object') visit(child);
    }
  }
  visit(value);
  return [...mapping];
}
