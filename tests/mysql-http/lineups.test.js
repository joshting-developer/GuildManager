import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp } from '../helpers/mysql-app.js';
import { emptyLineup } from '../../src/domain/lineups.js';

test('duties, templates, editor and default lineup index are assembled from awaited MySQL reads', async () =>
  withApp(async ({ admin, repository }) => {
    const { request } = await admin();
    await repository.addMember({ uid: '001', name: '名字001', primaryProfessionId: 1, secondaryProfessionId: 2, isInGuild: true, isInClub: false });
    const event = await repository.createEvent({ title: '', type: 'guild_war', dates: ['2099-10-24'], requestId: 'war' });
    const duties = await request('/duties');
    assert.equal(duties.headers.get('cache-control'), 'no-store');
    assert.equal((await duties.json()).duties.length, 3);
    const added = await request('/duties', 'POST', { name: '偵查', requestId: 'duty-1' });
    assert.equal(added.status, 201);
    const duty = (await added.json()).duty;
    const toggled = await request(`/duties/${duty.id}`, 'PATCH', { name: '偵查', active: false, revision: duty.revision });
    assert.equal(toggled.status, 200);
    assert.equal((await toggled.json()).duty.active, false);
    const editor = await request(`/lineups/editor?eventId=${event.id}`);
    assert.equal(editor.status, 200);
    const editorData = await editor.json();
    assert.equal(editorData.selected.eventId, event.id);
    assert.ok(Array.isArray(editorData.members));
    const teams = emptyLineup();
    teams[0].slots[0].uid = '001';
    const confirmed = await request('/lineups/confirm', 'POST', { eventId: event.id, eventRevision: event.revision, expectedVersion: 0, requestId: 'confirm', teams });
    assert.equal(confirmed.status, 201);
    assert.equal((await confirmed.json()).version.teams[0].slots[0].member.name, '名字001');
    const stale = await request('/lineups/confirm', 'POST', { eventId: event.id, eventRevision: event.revision, expectedVersion: 0, requestId: 'confirm-2', teams });
    assert.equal(stale.status, 409);
    const index = await request('/lineups?include=default');
    assert.equal(index.status, 200);
    const indexData = await index.json();
    assert.equal(indexData.selected.eventId, event.id);
    assert.equal(indexData.selected.versions.length, 1);
    assert.ok(indexData.selected.participation);
    const plain = await request('/lineups');
    assert.equal((await plain.json()).selected, undefined);
    const history = await request(`/lineups/events/${event.id}`);
    assert.equal((await history.json()).versions.length, 1);
    const template = await request('/lineups/templates', 'POST', { name: '基本', requestId: 'template', teams });
    assert.equal(template.status, 201);
    const templates = await request('/lineups/templates');
    assert.equal((await templates.json()).templates.length, 1);
    const applied = await request(`/lineups/templates/${(await template.json()).template.id}/apply/${event.id}`);
    assert.equal(applied.status, 200);
  }));


test('default lineup only reads the selected event and keeps archived snapshots without participation', async () => {
  const reads = [];
  await withApp({ repository: (repository) => ({
    ...repository,
    getLineupHistory: async (id) => { reads.push(['history', id]); return repository.getLineupHistory(id); },
    getEventParticipation: async (id) => { reads.push(['participation', id]); return repository.getEventParticipation(id); },
  }) }, async ({ admin, repository }) => {
    const { request } = await admin();
    assert.equal((await (await request('/lineups?include=default')).json()).selected, null);
    assert.deepEqual(reads, []);
    const event = await repository.createEvent({ title: '預設場次', type: 'guild_war', dates: ['2099-10-24'], requestId: 'selected' });
    await repository.createEvent({ title: '其他場次', type: 'guild_war', dates: ['2099-10-25'], requestId: 'unrelated' });
    await request('/lineups');
    assert.deepEqual(reads, [], 'plain index must not load history or participation');
    const active = await request('/lineups?include=default');
    assert.equal(active.status, 200);
    assert.equal((await active.json()).selected.eventId, event.id);
    assert.deepEqual(reads, [['history', event.id], ['participation', event.id]]);

    await repository.confirmLineup({ eventId: event.id, eventRevision: event.revision, expectedVersion: 0, requestId: 'archive-version', teams: emptyLineup() });
    await repository.deleteEvent(event.id, event.revision);
    reads.length = 0;
    const archived = await request('/lineups?include=default');
    assert.equal(archived.status, 200);
    const data = await archived.json();
    assert.equal(data.selected.eventId, event.id);
    assert.equal(data.selected.versions.length, 1);
    assert.equal(data.selected.participation, null);
    assert.deepEqual(reads, [['history', event.id]], 'archived event must not request unavailable participation');
  });
});
