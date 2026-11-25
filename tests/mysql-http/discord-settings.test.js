import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordSettingsRepository } from '../../server/mysql/discord-settings-repository.js';
import { createStore } from '../../server/mysql/store.js';
import { repositoryDatabase } from '../helpers/mysql-repository.js';
import { withApp } from '../helpers/mysql-app.js';
import { createDiscordNotifier } from '../../server/discord-notifier.js';
const url = 'https://discord.com/api/webhooks/123456/synthetic-token';

test('admin webhook settings hide secrets, reject stale writes and apply changes without restart', async () => {
  let repository;
  const calls = [];
  const notifier = createDiscordNotifier({ env: {}, getWebhooks: () => repository.getDiscordWebhooks(),
    fetchImpl: async (target, options) => { calls.push({ target, payload: JSON.parse(options.body) }); return { ok: true, status: 204 }; } });
  await withApp({ notifier }, async app => {
    repository = app.repository;
    const fallback = createDiscordSettingsRepository(createStore(repositoryDatabase(repository)), { env: { DISCORD_WEBHOOK_LEAVE: url } });
    assert.equal((await fallback.getDiscordWebhooks()).leave, url);
    assert.equal((await app.request('/admin/discord-settings')).status, 401);
    const admin = await app.admin();
    await repository.createAccount({ username: 'test_manager', password: 'test-password-2026', role: 'manager' });
    const manager = await app.login({ username: 'test_manager', password: 'test-password-2026' });
    for (const method of ['GET', 'PATCH', 'POST']) {
      const path = '/admin/discord-settings' + (method === 'POST' ? '/test' : '');
      assert.equal((await manager.request(path, method, method === 'GET' ? undefined : {})).status, 403);
    }
    assert.equal((await app.request('/admin/discord-settings','PATCH',{}, { Cookie: admin.headers.Cookie })).status, 403);
    let response = await admin.request('/admin/discord-settings');
    assert.equal(response.status, 200);
    let row = (await response.json()).channels.find(r => r.channel === 'leave');
    const save = input => admin.request('/admin/discord-settings','PATCH',input);
    assert.equal((await save({ channel:'leave', url:'https://example.com/secret', revision:row.revision })).status,422);
    response = await save({ channel:'leave', url, revision:row.revision });
    assert.equal(response.status,200);
    const text = await response.text(); assert.ok(!text.includes('synthetic-token')); assert.ok(!text.includes('https:'));
    assert.equal((await save({ channel:'leave',url:'',revision:row.revision })).status,409);
    response = await admin.request('/admin/discord-settings/test','POST',{channel:'leave'});
    assert.equal(response.status,200); assert.equal(calls.at(-1).target,url);
    const notice = {type:'leave',action:'leave',name:'測試成員',event:{date:'2026-11-25',type:'scrimmage'}};
    await notifier.send([notice]); assert.equal(calls.length,2);
    row = JSON.parse(text).channels.find(r => r.channel === 'leave');
    assert.equal((await save({channel:'leave',url:'',revision:row.revision})).status,200);
    await notifier.send([notice]); assert.equal(calls.length,2);
    assert.equal((await fallback.getDiscordWebhooks()).leave, '');
    const failing = createDiscordNotifier({ fetchImpl: async () => { throw new Error(url); } });
    assert.deepEqual(await failing.test(url), { ok: false });
    assert.equal((await admin.request('/admin/discord-settings/test','POST',{channel:'leave'})).status,502);
  });
});
