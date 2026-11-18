import { sessionFetch } from './session.js';
export function createBattleRecordClient({
  fetchImpl = sessionFetch,
} = {}) {
  async function call(path, input, method = 'POST') {
    let response;
    try {
      response = await fetchImpl(
        `/api/battle-records${path}`,
        input
          ? {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(input),
            }
          : {},
      );
    } catch {
      throw new Error('無法連線, 請確認本機服務已啟動後重試');
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('戰績回應格式不正確, 請稍後再試');
    }
    if (!response.ok) {
      const error = new Error(data.error?.message || '無法完成戰績操作');
      error.code = data.error?.code;
      throw error;
    }
    return data;
  }
  return {
    async getUploadRoster() {
      let data;

      let response;
      try { response = await fetchImpl('/api/battle-upload/roster'); }
      catch { throw new Error('名冊讀取失敗，請確認連線後重試'); }
      try { data = await response.json(); }
      catch { throw new Error('名冊格式不正確，請重試'); }
      if (!response.ok) throw Object.assign(new Error(data.error?.message || '名冊讀取失敗，請重試'), { code: data.error?.code });

      if (!Array.isArray(data?.members) || data.members.some(member => !member || typeof member.uid !== 'string' ||
          !member.uid || typeof member.name !== 'string' || !Number.isSafeInteger(member.revision) || member.revision < 1 ||
          typeof member.isInGuild !== 'boolean' || typeof member.isInClub !== 'boolean' || typeof member.profession !== 'string'))
        throw new Error('名冊格式不正確，請重試');
      return data;
    },
    getRecords: (page = 1, eventId = null) =>
      call(
        `?page=${page}${eventId ? `&eventId=${encodeURIComponent(eventId)}` : ''}`, undefined,
      ),
    getMetadata: (id) => call(`/${encodeURIComponent(id)}/metadata`, undefined),
    getRecord: (id, options) => call(`/${encodeURIComponent(id)}${options ? `?${new URLSearchParams(options)}` : ''}`, undefined),
    getTeamAnalysis: (id) => call(`/${encodeURIComponent(id)}/team-analysis`, undefined),
    saveRecords: (input) => call('', input),
    updateRecord: (id, input) =>
      call(`/${encodeURIComponent(id)}`, input, 'PATCH'),
    deleteRecord: (id, revision) =>
      call(`/${encodeURIComponent(id)}`, { revision }, 'DELETE'),
    async getAttachment(id, kind) {
      if (!['csv', 'image'].includes(kind)) throw new Error('未知附件類型');

      let response;
      try {
        response = await fetchImpl(
          `/api/battle-records/${encodeURIComponent(id)}/attachments/${kind}`,
        );
      } catch {
        throw new Error('附件下載失敗, 請重試');
      }
      if (!response.ok) {
        let data;
        try {
          data = await response.json();
        } catch {}
        throw new Error(data?.error?.message || '附件下載失敗, 請重試');
      }
      return response.blob();
    },
  };
}
