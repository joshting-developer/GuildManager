import { unpackPersonalBattles } from '../domain/personal-battle-transport.js';
import { sessionFetch } from './session.js';

// Share profession reads per HTTP transport for the page lifetime.
const professionCache = new WeakMap();
export function createMemberClient({ fetchImpl = sessionFetch } = {}) {
  async function call(method, path, body) {
    let response;
    try {
      response = await fetchImpl(`/api/${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error('無法連線，請確認本機服務已啟動後重試');
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('資料回應格式不正確，請稍後再試');
    }
    if (!response.ok) {
      const error = new Error(data.error?.message || '目前無法完成操作，請稍後再試');
      error.fields = data.error?.fields || {};
      error.code = data.error?.code;
      error.rows = data.error?.rows || [];
      throw error;
    }
    return data;
  }
  return {
    getParticipationMembers: () => call('GET', 'calendar/members', null),
    getMembers: () => call('GET', 'members', null),
    getBattleRecords: (uid, page = 1, filters = {}) =>
      call(
        'GET', `members/${encodeURIComponent(uid)}/battle-records?${new URLSearchParams({ page, ...filters })}`, null,
      ).then(unpackPersonalBattles),
    // Re-reads selected rows 100 keys per request; rows that no longer exist are simply absent.
    async getBattleRecordsByKeys(uid, keys) {
      const entries = [];
      for (let index = 0; index < keys.length; index += 100) {
        const data = await call('GET', `members/${encodeURIComponent(uid)}/battle-records?${new URLSearchParams({
          keys: keys.slice(index, index + 100).join(','),
        })}`, null);
        if (!Array.isArray(data?.entries)) throw new Error('個人戰績回應格式不正確，請重新載入');
        entries.push(...data.entries);
      }
      return entries;
    },
    getProfessions({ refresh = false } = {}) {
      const key = fetchImpl;
      if (refresh) professionCache.delete(key);
      if (!professionCache.has(key)) {
        const request = call('GET', 'professions', null);
        professionCache.set(key, request);
        // A failed read must not stick; the next caller retries.
        request.catch(() => {
          if (professionCache.get(key) === request) professionCache.delete(key);
        });
      }
      return professionCache.get(key);
    },
    async addProfession(input) {
      const data = await call('POST', 'professions', input);
      professionCache.delete(fetchImpl);
      return data;
    },
    async updateProfession(id, input) {
      const data = await call('PATCH', `professions/${encodeURIComponent(id)}`, input);
      professionCache.delete(fetchImpl);
      return data;
    },
    previewMemberImport: (input) =>
      call('POST', 'members/import/preview', input),
    importMembers: (input) => call('POST', 'members/import', input),
    addMember: (input) => call('POST', 'members', input),
    updateMember: (uid, input) =>
      call('PATCH', `members/${encodeURIComponent(uid)}`, input),
    getMemberMaintenance: (uid) =>
      call('GET', `members/${encodeURIComponent(uid)}/maintenance`, null),
    maintainMember: (uid, input) =>
      call('PATCH', `members/${encodeURIComponent(uid)}/maintenance`, input),
    saveMemberNameHistory: (uid, input) =>
      call('PATCH', `members/${encodeURIComponent(uid)}/history`, input),
    deleteMemberPermanently: (uid, input) =>
      call('POST', `members/${encodeURIComponent(uid)}/permanent-delete`, input),
    removeMember: (uid, revision) =>
      call('DELETE', `members/${encodeURIComponent(uid)}`, { revision }),
  };
}
