import { sessionFetch } from './session.js';
export function createLineupClient({ fetchImpl = sessionFetch } = {}) {
  async function call(path, method = 'GET', input) {
    let response;
    try {
      response = await fetchImpl(`/api/lineups${path}`, {
        method,
        ...(input
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
          : {}),
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
      const error = new Error(data.error?.message || '目前無法完成排表操作');
      error.code = data.error?.code;
      throw error;
    }
    return data;
  }
  return {
    // { include: 'default' } also returns the nearest battle's versions and sign-ups.
    getIndex: (options) =>
      options
        ? call(`?include=${encodeURIComponent(options.include)}`, 'GET', null)
        : call(''),
    getEditor: (eventId = null) => call(`/editor${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''}`, 'GET', null),
    getEvent: (id, { includeCatalogs = false } = {}) => call(`/events/${encodeURIComponent(id)}/current?includeCatalogs=${includeCatalogs}`, 'GET', null),
    getTemplates: () => call('/templates'),
    getSources: (id) => call(`/events/${encodeURIComponent(id)}/sources`, 'GET', null),
    getHistory: (id) =>
      call(`/events/${encodeURIComponent(id)}`, 'GET', null),
    confirm: (input) => call('/confirm', 'POST', input),
    // Permanently removes a 本場外援 registration (managers only).
    deleteGuest: (eventId, id, revision) =>
      call(
            `/events/${encodeURIComponent(eventId)}/guests/${encodeURIComponent(id)}`, 'DELETE', { revision },
          ),
    createTemplate: (input) => call('/templates', 'POST', input),
    deleteTemplate: (id) =>
      call(`/templates/${encodeURIComponent(id)}`, 'DELETE', {}),
    applyTemplate: (id, eventId) =>
      call(
        `/templates/${encodeURIComponent(id)}/apply/${encodeURIComponent(eventId)}`, 'GET', null,
      ),
  };
}
