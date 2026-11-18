import { asyncMap } from "../../server/mysql/collections.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

const types = ['scrimmage', 'guild_war', 'dragon_tiger'];
const video = (event, extra = {}) => ({ name: '公開影片', professionId: 3,
  firstUrl: 'https://example.com/video', secondUrl: '', groupName: '進攻一', note: '',
  eventRevision: event.revision, requestId: crypto.randomUUID(), ...extra });
async function seedLocal() {
  const repo = (await createRepository());
  for (const [uid, isInGuild, isInClub] of [['guild', true, false], ['club', false, true], ['outside', false, false]])
    (await repo.addMember({ uid, name: uid, primaryProfessionId: 3, isInGuild, isInClub }));
  const events = (await asyncMap([...types, 'activity'], async type => (await repo.createEvent({ title: type, type,
    dates: ['2026-10-01'], requestId: type }))));
  (await repo.saveMemberResponse(events[0].id, { uid: 'guild', status: 'leave', note: '不應出現在影片表單', revision: 0 }));
  (await repo.addGuestRegistration(events[0].id, { name: '外援', professionId: 3, requestId: 'guest' }));
  return { repo, events };
}

test('video form preserves the legacy public roster and professions without returning participant responses or versions', async () => {
  const { repo, events } = (await seedLocal());
  try {
    const old = (await repo.getEventParticipationForm(events[0].id));
    for (const event of events.slice(0, 3)) {
      const form = (await repo.getEventVideoForm(event.id));
      assert.deepEqual(Object.keys(form).sort(), ['event', 'eventId', 'members', 'professions']);
      assert.deepEqual(form.event, (await repo.getEvent(event.id)).event);
      assert.deepEqual(form.members, old.members);
      assert.deepEqual(form.professions, old.professions);
      assert.deepEqual(form.members.map(row => row.uid).sort(), ['club', 'guild']);
    }
    assert.deepEqual((await repo.getEventParticipationForm(events[0].id)), old);
    assert.equal(old.responses[0].note, '不應出現在影片表單');
    (await repo.updateEvent(events[0].id, { ...events[0], title: '已修改', revision: events[0].revision }));
    assert.equal((await repo.getEventVideoForm(events[0].id)).event.revision, 2);
    (await assert.rejects(async () => (await repo.getEventVideoForm(events[3].id))));
    (await repo.deleteEvent(events[1].id, 1));
    (await assert.rejects(async () => (await repo.getEventVideoForm(events[1].id))));
    (await assert.rejects(async () => (await repo.getEventVideoForm('missing'))));
  } finally { (await repo.close()); }
});
