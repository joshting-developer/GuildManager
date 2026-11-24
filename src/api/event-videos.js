import { sessionFetch } from './session.js';
import { validateVideoDetails, validateVideoProfessionUpdate, validateVideoMove, validateVideoDelete } from '../domain/event-videos.js';
import { isBattleEvent } from '../domain/battle-events.js';

const videoPath = (eventId, videoId) => `/api/events/${encodeURIComponent(eventId)}/videos/${encodeURIComponent(videoId)}`;

export function createEventVideoClient({
  fetchImpl = sessionFetch,
} = {}) {
  async function request(path, input, method = input ? 'POST' : 'GET') {
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
    const data = await request(`/api/events/${encodeURIComponent(eventId)}/videos`, input);
    return validateResponse(data, eventId, input);
  }
  function validateResponse(data, eventId, input) {
    const videos = input ? [data.video] : data.videos;
    if (
      !Array.isArray(videos) ||
      (!input && (data.eventId !== eventId || !Number.isSafeInteger(data.total) || data.total < 0 ||
        !Number.isSafeInteger(data.page) || data.page < 1 || !Number.isSafeInteger(data.limit) || data.limit < 1 || data.limit > 200 || videos.length > data.limit))
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
    async getChoices(cursor = null) {
      const data = await request(`/api/videos/choices${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (!Array.isArray(data?.events) || !data.events.every(isBattleEvent) ||
        typeof data.hasMore !== 'boolean' || (data.nextCursor !== null && typeof data.nextCursor !== 'string'))
        throw new Error('影片閱覽資料回應格式不正確，請重試');
      return data;
    },
    async getBrowser(eventId = null, options = {}) {
      const params = new URLSearchParams({ ...(eventId ? { eventId } : {}), ...options });
      const data = await request(`/api/videos/browser${params.size ? `?${params}` : ''}`);
      if (!Array.isArray(data?.events) || !data.events.every(isBattleEvent) ||
        (data.events.length === 0 ? data.selected !== null :
          !data.selected || !data.events.some(event => event.id === data.selected.eventId)))
        throw new Error('影片閱覽資料回應格式不正確，請重試');
      if (data.selected) validateResponse(data.selected, data.selected.eventId);
      return data;
    },
    async getNames(eventId, options = {}) {
      const params = new URLSearchParams(options);
      const data = await request(`/api/events/${encodeURIComponent(eventId)}/video-names?${params}`);
      if (data?.eventId !== eventId || !Array.isArray(data.names) || data.names.length > 20 ||
          !data.names.every(row => typeof row?.name === 'string' &&
            (row.professionId === null || (Number.isSafeInteger(row.professionId) && row.professionId > 0)) &&
            (row.professionName === null || typeof row.professionName === 'string')) ||
          !Number.isSafeInteger(data.total) || data.total < 0 ||
          !Number.isSafeInteger(data.page) || data.page < 1 || data.limit !== 20)
        throw new Error('已上傳影片名單回應格式不正確, 請重試');
      return data;
    },
    async getVideos(eventId, options = {}) {
      const params = new URLSearchParams(options);
      return validateResponse(await request(`/api/events/${encodeURIComponent(eventId)}/videos${params.size ? `?${params}` : ''}`), eventId);
    },
    async getAllVideos(eventId, options = {}) {
      const videos = [];
      for (let page = 1; ; page++) {
        const data = await this.getVideos(eventId, { ...options, page, limit: 200 });
        videos.push(...data.videos);
        if (page * data.limit >= data.total || data.videos.length === 0) return videos;
      }
    },
    submitVideo: (eventId, input) => call(eventId, input),
    async updateProfession(eventId, videoId, input) {
      const values = validateVideoProfessionUpdate(eventId, videoId, input);
      const data = await request(`/api/events/${encodeURIComponent(eventId)}/videos/${encodeURIComponent(videoId)}/profession`, values, 'PATCH');
      if (!data?.video || data.video.eventId !== eventId || data.video.id !== videoId || data.video.professionId !== values.professionId ||
          data.video.revision !== values.revision + 1 || typeof data.video.professionName !== 'string' ||
          !data.video.professionName || typeof data.video.professionColorcode !== 'string')
        throw new Error('職業修改回應格式不正確，請重新載入確認');
      validateVideoDetails(data.video, { allowMissingGroup: true });
      return data;
    },
    async moveVideo(eventId, videoId, input) {
      const values = validateVideoMove(eventId, videoId, input);
      const data = await request(`${videoPath(eventId, videoId)}/event`, values, 'PATCH');
      if (!data?.video || data.fromEventId !== eventId || data.video.id !== videoId ||
          data.video.eventId !== values.targetEventId || !Number.isSafeInteger(data.video.revision))
        throw new Error('更換場次回應格式不正確，請重新載入確認');
      validateVideoDetails(data.video, { allowMissingGroup: true, allowMissingProfession: true });
      return data;
    },
    async deleteVideo(eventId, videoId, input) {
      const values = validateVideoDelete(eventId, videoId, input);
      const data = await request(videoPath(eventId, videoId), values, 'DELETE');
      if (data?.deleted !== true || data.eventId !== eventId || data.videoId !== videoId)
        throw new Error('刪除影片回應格式不正確，請重新載入確認');
      return data;
    },
  };
}
