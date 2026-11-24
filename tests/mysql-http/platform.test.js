import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp } from '../helpers/mysql-app.js';

test('platform settings, lottery and event videos answer after the committed MySQL state', async () =>
  withApp(async ({ request: anonymous, admin, repository }) => {
    const { request } = await admin();
    const settings = await anonymous('/platform-settings');
    assert.equal(settings.status, 200);
    const { platform } = await settings.json();
    assert.equal(typeof platform.name, 'string');
    const renamed = await request('/admin/platform-settings', 'PATCH', { name: '測試幫會', revision: platform.revision });
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json()).platform.name, '測試幫會');
    assert.equal((await (await anonymous('/platform-settings')).json()).platform.name, '測試幫會');
    const invalid = await request('/admin/platform-settings', 'PATCH', { name: '', revision: platform.revision + 1 });
    assert.equal(invalid.status, 422);
    assert.equal((await invalid.json()).error.code, 'INVALID_PLATFORM_NAME');

    const lottery = await request('/lottery');
    assert.equal(lottery.status, 200);
    const board = (await lottery.json()).lottery;
    const saved = await request('/lottery', 'PATCH', { players: ['甲', '乙'], prizes: ['金條'], revision: board.revision });
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).lottery.players, ['甲', '乙']);

    const event = await repository.createEvent({ title: '約戰', type: 'scrimmage', dates: ['2026-10-24'], requestId: 'video-event' });
    const video = { name: '空城', professionId: 3, firstUrl: 'https://www.youtube.com/watch?v=example', secondUrl: '', note: '', groupName: '進攻一', eventRevision: event.revision, requestId: 'video-1' };
    const submitted = await anonymous(`/events/${event.id}/videos`, 'POST', video);
    assert.equal(submitted.status, 201);
    const listed = await request(`/events/${event.id}/videos`);
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).videos.length, 1);
    const publicList = await anonymous(`/events/${event.id}/videos`);
    assert.equal(publicList.status, 200);
    const publicData = await publicList.json();
    assert.equal(publicData.canManage, false);
    assert.equal(publicData.videos[0].name, video.name);
    for (const field of ['firstUrl', 'secondUrl', 'note'])
      assert.equal(field in publicData.videos[0], false, `public video list must omit ${field}`);
    const browser = await request(`/videos/browser?eventId=${event.id}`);
    assert.equal(browser.status, 200);
    assert.equal((await browser.json()).selected.videos.length, 1);
    const form = await anonymous(`/events/${event.id}/video-form`);
    assert.equal(form.status, 200);
    assert.equal((await form.json()).professions.length, 9);
  }));
