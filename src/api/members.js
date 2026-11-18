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
    getProfessions() {
      const key = fetchImpl;
      if (!professionCache.has(key)) {
        const request = call('GET', 'professions', null);
        professionCache.set(key, request);
        // A failed read must not stick; the next caller retries.
        request.catch(() => professionCache.delete(key));
      }
      return professionCache.get(key);
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
