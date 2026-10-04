import { callGas } from './gas.js';
import { sessionFetch } from './session.js';
import { validateVideoDetails } from '../domain/event-videos.js';

export function createEventVideoClient({
  source = 'local',
  fetchImpl = sessionFetch,
  googleRun,
} = {}) {
  if (!['local', 'gas'].includes(source)) throw new Error('未知的資料來源設定');
  async function call(eventId, input) {
    if (source === 'gas') {
      const data = await callGas(
        input ? 'submitEventVideo' : 'getEventVideos',
        input ? [eventId, input] : [eventId],
        googleRun,
      );
      return validateResponse(data, eventId, input);
    }
    let response;
    try {
      response = await fetchImpl(`/api/events/${encodeURIComponent(eventId)}/videos`, {
        method: input ? 'POST' : 'GET',
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
          ['name', 'firstUrl', 'secondUrl', 'groupName', 'note'].some(
            (field) => video[field] !== input[field],
          ))
      )
        throw new Error('影片資料回應格式不正確，請重試');
      validateVideoDetails(video, { allowMissingGroup: !input });
    }
    return data;
  }
  return {
    getVideos: (eventId) => call(eventId),
    submitVideo: (eventId, input) => call(eventId, input),
  };
}
