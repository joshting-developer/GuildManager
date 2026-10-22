import { callGas } from './gas.js';
import { sessionFetch } from './session.js';

// Calendar, lineups, uploads, videos and management all start by listing events, and each
// cloud call costs ~2 s. Within one page session the list is reused for a minute; any event
// write on this transport, or a sign-in/out (visibility depends on the role), clears it.
const EVENT_LIST_TTL_MS = 60 * 1000;
const eventListCache = new Map();
const DEFAULT_GAS = {};
export function forgetEventList() {
  eventListCache.clear();
}
export function createEventClient({ source = 'local', fetchImpl = sessionFetch, googleRun } = {}) {
  if (!['local', 'gas'].includes(source)) throw new Error('未知的資料來源設定');
  async function call(method, input, id) {
    if (source === 'gas') {
      const operation = {
        GET: id === undefined ? 'getEvents' : 'getEvent',
        POST: 'createEvent',
        PATCH: 'updateEvent',
        DELETE: 'deleteEvent',
      }[method];
      const args =
        method === 'GET'
          ? id === undefined ? [] : [id]
          : method === 'POST'
            ? [input]
            : [id, method === 'DELETE' ? input.revision : input];
      return callGas(operation, args, googleRun);
    }
    let response;
    try {
      response = await fetchImpl(
        id === undefined ? '/api/events' : `/api/events/${encodeURIComponent(id)}`,
        {
          method,
          ...(input
            ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
            : {}),
        },
      );
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
      throw error;
    }
    return data;
  }
  const cacheKey = source === 'gas' ? googleRun || DEFAULT_GAS : fetchImpl;
  function writing(request) {
    eventListCache.delete(cacheKey);
    // A write finishing later must not leave a list cached in the meantime.
    return request.finally(() => eventListCache.delete(cacheKey));
  }
  return {
    getEvents() {
      const cached = eventListCache.get(cacheKey);
      if (cached && Date.now() - cached.at < EVENT_LIST_TTL_MS) return cached.request;
      const request = call('GET');
      eventListCache.set(cacheKey, { request, at: Date.now() });
      request.catch(() => {
        if (eventListCache.get(cacheKey)?.request === request) eventListCache.delete(cacheKey);
      });
      return request;
    },
    getEvent: (id) => call('GET', undefined, id),
    createEvent: (input) => writing(call('POST', input)),
    updateEvent: (id, input) => writing(call('PATCH', input, id)),
    deleteEvent: (id, revision) => writing(call('DELETE', { revision }, id)),
  };
}
