import { callGas } from './gas.js';
import { sessionFetch } from './session.js';
export function createMemberClient({ source = 'local', fetchImpl = sessionFetch, googleRun } = {}) {
  if (!['local', 'gas'].includes(source)) throw new Error('未知的資料來源設定');
  async function call(method, path, body, operation, args = []) {
    if (source === 'gas') {
      return callGas(operation, args, googleRun);
    }
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
    getParticipationMembers: () => call('GET', 'calendar/members', null, 'getParticipationMembers'),
    getMembers: () => call('GET', 'members', null, 'getMembers'),
    getBattleRecords: (uid, page = 1) =>
      call(
        'GET',
        `members/${encodeURIComponent(uid)}/battle-records?page=${page}`,
        null,
        'getMemberBattleRecords',
        [uid, page],
      ),
    getProfessions: () => call('GET', 'professions', null, 'getProfessions'),
    previewMemberImport: (input) =>
      call('POST', 'members/import/preview', input, 'previewMemberImport', [input]),
    importMembers: (input) => call('POST', 'members/import', input, 'importMembers', [input]),
    addMember: (input) => call('POST', 'members', input, 'addMember', [input]),
    updateMember: (uid, input) =>
      call('PATCH', `members/${encodeURIComponent(uid)}`, input, 'updateMember', [uid, input]),
    removeMember: (uid, revision) =>
      call('DELETE', `members/${encodeURIComponent(uid)}`, { revision }, 'removeMember', [
        uid,
        revision,
      ]),
  };
}
