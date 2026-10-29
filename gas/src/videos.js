import { EventVideoError, validateVideoSubmission, validateVideoProfessionUpdate } from '../../src/domain/event-videos.js';
import { canonical, fail, hash } from './common.js';
import { videoBrowserSelection } from '../../src/domain/video-browser.js';

export function createVideos(store, catalog, { uuid, now }) {
  function checkEvent(eventId) {
    const event = catalog.event(eventId, { battle: true });
    if (event.dates.length !== 1) fail('EVENT_UNAVAILABLE', '影片需要單日戰鬥場次');
    return event;
  }
  const methods = {
    updateEventVideoProfession([eventId, videoId, rawInput]) {
      const input = validateVideoProfessionUpdate(eventId, videoId, rawInput);
      const key = `video-profession:${input.requestId}`;
      const fingerprint = hash(canonical({ eventId, videoId, ...input }));
      const previous = store.get('requests', key);
      if (previous) {
        if (previous.hash !== fingerprint)
          fail('REQUEST_CONFLICT', '這次操作識別碼已用於其他內容，請重新操作');
        return previous.result;
      }
      try { checkEvent(eventId); }
      catch (error) {
        if (['EVENT_NOT_FOUND', 'EVENT_INVALID', 'EVENT_UNAVAILABLE'].includes(error.code))
          throw new EventVideoError('這個場次已刪除或無法使用影片功能，請重新載入', 409, 'EVENT_UNAVAILABLE');
        throw error;
      }
      const current = store.get('videos', videoId);
      if (!current || current.eventId !== eventId) fail('VIDEO_NOT_FOUND', '找不到這筆影片，請重新載入');
      if ((current.revision ?? 0) !== input.revision)
        fail('REVISION_CONFLICT', '這筆影片已更新，請重新載入後確認職業再儲存');
      const profession = store.get('professions', input.professionId);
      if (!profession)
        throw new EventVideoError('請選擇有效職業', 422, 'VIDEO_INVALID', { professionId: '職業已失效，請重新載入' });
      const video = { ...current, professionId: profession.job_id, professionName: profession.name,
        professionColorcode: profession.colorcode, revision: input.revision + 1 };
      const result = { video };
      store.put('videos', videoId, video);
      store.put('requests', key, { hash: fingerprint, result });
      return result;
    },
    getVideoBrowser([preferredId = null] = []) {
      const { events, eventId } = videoBrowserSelection(catalog.liveEvents(), preferredId);
      return { events, selected: eventId ? methods.getEventVideos([eventId]) : null };
    },
    getEventVideos([eventId]) {
      const event = checkEvent(eventId);
      store.ensureTable('videos');
      return {
        eventId,
        eventRevision: event.revision,
        videos: store
          .all('videos')
          .filter((video) => video.eventId === eventId)
          .map(video => ({ ...video, revision: video.revision ?? 0 }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)),
      };
    },
    submitEventVideo([eventId, rawInput]) {
      const input = validateVideoSubmission(rawInput);
      const key = `video:${input.requestId}`;
      const fingerprint = hash(canonical({ eventId, ...input }));
      const previous = store.get('requests', key);
      if (previous) {
        if (previous.hash !== fingerprint)
          fail('REQUEST_CONFLICT', '這次提交識別碼已用於其他內容，請重新送出');
        return previous.result;
      }
      const event = checkEvent(eventId);
      if (event.revision !== input.eventRevision)
        fail('EVENT_CHANGED', '場次已修改，請重新載入場次後再送出');
      const profession = store.get('professions', input.professionId);
      if (!profession)
        throw new EventVideoError('請選擇有效職業', 422, 'VIDEO_INVALID', { professionId: '職業已失效，請重新載入' });
      if (input.memberUid) {
        const member = store.get('members', input.memberUid);
        if (!member || member.name !== input.name || !(member.isInGuild || member.isInClub))
          throw new EventVideoError('成員資料已更新，請重新載入後選擇成員', 409, 'VIDEO_MEMBER_CHANGED', { name: '請重新選擇成員' });
      }
      store.ensureTable('videos');
      const { name, firstUrl, secondUrl, groupName, note } = input;
      const video = {
        id: uuid(),
        eventId,
        name,
        professionId: profession.job_id,
        professionName: profession.name,
        professionColorcode: profession.colorcode,
        firstUrl,
        secondUrl,
        groupName,
        note,
        createdAt: now(),
        revision: 0,
      };
      const result = { video };
      store.put('videos', video.id, video);
      store.put('requests', key, { hash: fingerprint, result });
      return result;
    },
  };
  return methods;
}
