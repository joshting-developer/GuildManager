import { sessionFetch } from './session.js';

// Reuse event lists for one minute; writes and sign-in/out invalidate them.
const EVENT_LIST_TTL_MS = 60 * 1000;
const eventListCache = new Map();
export function forgetEventList() {
  eventListCache.clear();
}
export function createEventClient({ fetchImpl = sessionFetch } = {}) {
  async function call(method, input, id, query = '') {
    let response;
    try {
      response = await fetchImpl(
        id === undefined ? '/api/events' + query : `/api/events/${encodeURIComponent(id)}`,
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
  const cacheKey = fetchImpl;
  function writing(request) {
    forgetEventList();
    // A write finishing later must not leave a list cached in the meantime.
    return request.finally(() => forgetEventList());
  }
  return {
    getEvents(options = {}) {
      const query = new URLSearchParams(Object.entries(options).sort(([a], [b]) => a.localeCompare(b))).toString();
      let ranges = eventListCache.get(cacheKey);
      if (!ranges) { ranges = new Map(); eventListCache.set(cacheKey, ranges); }
      const cached = ranges.get(query);
      if (cached && Date.now() - cached.at < EVENT_LIST_TTL_MS) return cached.request;
      const request = call('GET', undefined, undefined, query ? '?' + query : '');
      if (ranges.size >= 24) ranges.delete(ranges.keys().next().value);
      ranges.set(query, { request, at: Date.now() });
      request.catch(() => {
        if (ranges.get(query)?.request === request) ranges.delete(query);
      });
      return request;
    },
    async getAllEvents(options = {}) {
      const events = [];
      for (let offset = 0; offset < 10000; offset += 200) {
        const result = await this.getEvents({ ...options, limit: 200, offset });
        events.push(...result.events);
        if (!result.hasMore) return { events };
      }
      throw new Error('場次超過清單上限, 請縮小日期範圍');
    },
    getEvent: (id) => call('GET', undefined, id),
    createEvent: (input) => writing(call('POST', input)),
    updateEvent: (id, input) => writing(call('PATCH', input, id)),
    deleteEvent: (id, revision) => writing(call('DELETE', { revision }, id)),
  };
}
