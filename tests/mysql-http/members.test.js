import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp, recordingNotifier } from '../helpers/mysql-app.js';

const member = (uid, extra = {}) => ({ uid, name: `名字${uid}`, primaryProfessionId: 1, secondaryProfessionId: null, ...extra });

test('member writes answer with the committed row and notify only after the commit', async () => {
  const notifier = recordingNotifier();
  await withApp({ notifier }, async ({ admin, repository }) => {
    const { request } = await admin();
    const created = await request('/members', 'POST', member('001'));
    assert.equal(created.status, 201);
    const saved = (await created.json()).member;
    assert.equal(saved.uid, '001');
    assert.equal(saved.revision, 1);
    assert.deepEqual(saved.previousNames, []);
    assert.equal(notifier.calls.length, 1);
    assert.equal(notifier.calls[0].notices[0].type, 'member');
    assert.equal(notifier.calls[0].notices[0].action, 'add');
    assert.equal(typeof notifier.calls[0].options.footer, 'string');
    const duplicate = await request('/members', 'POST', member('001'));
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error.code, 'DUPLICATE_UID');
    assert.equal(notifier.calls.length, 1, 'a failed write sends nothing');
    const renamed = await request('/members/001', 'PATCH', { name: '新名字', primaryProfessionId: 1, secondaryProfessionId: null, isInGuild: true, isInClub: false, revision: saved.revision });
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json()).member.previousNames[0].name, '名字001');
    assert.equal(notifier.calls.length, 2);
    const list = await request('/members');
    assert.equal(list.headers.get('cache-control'), 'no-store');
    assert.equal((await list.json()).members[0].name, '新名字');
    const removed = await request('/members/001', 'DELETE', { revision: 2 });
    assert.equal(removed.status, 200);
    assert.equal((await removed.json()).member.isInGuild, false);
    assert.equal(notifier.calls.length, 3);
    assert.equal((await repository.listMembers()).members.length, 1, 'removed members stay listed as external');
  });
});

test('import preview and import run on MySQL and send one summary notification', async () => {
  const notifier = recordingNotifier();
  await withApp({ notifier }, async ({ admin }) => {
    const { request } = await admin();
    const text = 'UID Name 主職業 副職業\n00012345678901234567890 第一位 碎夢 素問\n002 第二位 神相 -';
    const preview = await request('/members/import/preview', 'POST', { text });
    assert.equal(preview.status, 200);
    const body = await preview.json();
    assert.deepEqual(body.issues, []);
    assert.deepEqual(body.summary, { added: 2, restored: 0, skipped: 0 });
    const stale = await request('/members/import', 'POST', { text, fingerprint: 'x' });
    assert.equal(stale.status, 409);
    const imported = await request('/members/import', 'POST', { text, fingerprint: body.fingerprint });
    assert.equal(imported.status, 200);
    assert.equal((await imported.json()).members[0].uid, '00012345678901234567890');
    assert.equal(notifier.calls.length, 1);
    assert.equal(notifier.calls[0].notices[0].type, 'member-import');
    const maintenance = await request('/members/002/maintenance');
    assert.equal(maintenance.status, 200);
  });
});
