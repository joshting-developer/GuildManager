import { callGas } from './gas.js';
import { sessionFetch } from './session.js';
import { validateVideoDetails, validateVideoProfessionUpdate } from '../domain/event-videos.js';
import { isBattleEvent } from '../domain/battle-events.js';

export function createEventVideoClient({
  source = 'local',
  fetchImpl = sessionFetch,
  googleRun,
} = {}) {
  if (!['local', 'gas'].includes(source)) throw new Error('未知的資料來源設定');
  async function request(operation, path, args, input, method = input ? 'POST' : 'GET') {
    if (source === 'gas') {
      return callGas(operation, args, googleRun);
    }
    let response;
    try {
      response = await fetchImpl(path, {
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
      throw new Error('影片資料回應格式不正確，請重試');
    }
    if (!response.ok) {
      const error = new Error(data.error?.message || '目前無法完成影片操作');
      error.code = data.error?.code;
      error.fields = data.error?.fields || {};
      throw error;
    }
    return data;
  }
  async function call(eventId, input) {
    const data = await request(input ? 'submitEventVideo' : 'getEventVideos',
      `/api/events/${encodeURIComponent(eventId)}/videos`, input ? [eventId, input] : [eventId], input);
    return validateResponse(data, eventId, input);
  }
  function validateResponse(data, eventId, input) {
    const videos = input ? [data.video] : data.videos;
    if (
      !Array.isArray(videos) ||
      (!input && (data.eventId !== eventId || !Number.isSafeInteger(data.eventRevision)))
    )
      throw new Error('影片資料回應格式不正確，請重試');
    for (const video of videos) {
      if (
        !video ||
        video.eventId !== eventId ||
        typeof video.id !== 'string' ||
        !video.id ||
        (input &&
          ['name', 'professionId', 'firstUrl', 'secondUrl', 'groupName', 'note'].some(
            (field) => video[field] !== input[field],
          ))
      )
        throw new Error('影片資料回應格式不正確，請重試');
      validateVideoDetails(video, { allowMissingGroup: !input, allowMissingProfession: !input });
      if (video.revision !== undefined && (!Number.isSafeInteger(video.revision) || video.revision < 0))
        throw new Error('影片版本格式不正確，請重新載入');
    }
    return data;
  }
  return {
    async getBrowser(eventId = null) {
      const data = await request('getVideoBrowser',
        `/api/videos/browser${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''}`, [eventId]);
      if (!Array.isArray(data?.events) || !data.events.every(isBattleEvent) ||
        (data.events.length === 0 ? data.selected !== null :
          !data.selected || !data.events.some(event => event.id === data.selected.eventId)))
        throw new Error('影片閱覽資料回應格式不正確，請重試');
      if (data.selected) validateResponse(data.selected, data.selected.eventId);
      return data;
    },
    getVideos: (eventId) => call(eventId),
    submitVideo: (eventId, input) => call(eventId, input),
    async updateProfession(eventId, videoId, input) {
      const values = validateVideoProfessionUpdate(eventId, videoId, input);
      const data = await request('updateEventVideoProfession',
        `/api/events/${encodeURIComponent(eventId)}/videos/${encodeURIComponent(videoId)}/profession`,
        [eventId, videoId, values], values, 'PATCH');
      if (!data?.video || data.video.eventId !== eventId || data.video.id !== videoId || data.video.professionId !== values.professionId ||
          data.video.revision !== values.revision + 1 || typeof data.video.professionName !== 'string' ||
          !data.video.professionName || typeof data.video.professionColorcode !== 'string')
        throw new Error('職業修改回應格式不正確，請重新載入確認');
      validateVideoDetails(data.video, { allowMissingGroup: true });
      return data;
    },
  };
}
