import { callGas } from './gas.js';
import { sessionFetch } from './session.js';
export function createLineupClient({ source = 'local', fetchImpl = sessionFetch, googleRun } = {}) {
  if (!['local', 'gas'].includes(source)) throw new Error('未知的資料來源設定');
  async function call(name, path, method = 'GET', input, args = []) {
    if (source === 'gas') {
      return callGas(name, input ? [input] : args, googleRun);
    }
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
        ? call('getLineupIndex', `?include=${encodeURIComponent(options.include)}`, 'GET', null, [options])
        : call('getLineupIndex', ''),
    getHistory: (id) =>
      call('getLineupHistory', `/events/${encodeURIComponent(id)}`, 'GET', null, [id]),
    confirm: (input) => call('confirmLineup', '/confirm', 'POST', input),
    // Permanently removes a 本場外援 registration (managers only).
    deleteGuest: (eventId, id, revision) =>
      source === 'gas'
        ? callGas('deleteGuestRegistration', [eventId, id, revision], googleRun)
        : call(
            'deleteGuestRegistration',
            `/events/${encodeURIComponent(eventId)}/guests/${encodeURIComponent(id)}`,
            'DELETE',
            { revision },
          ),
    createTemplate: (input) => call('createLineupTemplate', '/templates', 'POST', input),
    applyTemplate: (id, eventId) =>
      call(
        'applyLineupTemplate',
        `/templates/${encodeURIComponent(id)}/apply/${encodeURIComponent(eventId)}`,
        'GET',
        null,
        [id, eventId],
      ),
  };
}
