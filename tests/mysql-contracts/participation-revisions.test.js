import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository, repositoryDatabase } from '../helpers/mysql-repository.js';
import { createMysqlRepository } from '../../server/mysql/repository.js';
import { participationTarget } from '../../src/domain/participation-target.js';
import { VIDEO_GROUPS } from '../../src/domain/event-videos.js';

test('individual revisions, real parallel retries, latest event eligibility and historical videos', async () => {
  const now = () => new Date('2026-11-18T12:00:00+08:00');
  const repo = await createTestRepository({ participationNow: now });
  const peer = createMysqlRepository(repositoryDatabase(repo), { participationNow: now });
  try {
    for (const uid of ['a','b']) await repo.addMember({ uid, name: uid, primaryProfessionId: 1, isInGuild: true });
    let event = await repo.createEvent({ title: '原標題', type: 'scrimmage', dates: ['2026-11-19'], requestId: 'new-event' });
    const form = await repo.getEventParticipationForm(event.id);
    assert.equal(Object.hasOwn(form, 'revision'), false);
    const input = (name, snapshot=form) => ({ name, memberUid: name, status: 'leave', note: '', requestId: crypto.randomUUID(), expectedParticipant: { person: participationTarget({ name, memberUid: name, status: 'leave' },snapshot) } });
    const a=input('a'),b=input('b');
    const different = await Promise.all([repo.submitParticipation(event.id,a),peer.submitParticipation(event.id,b)]);
    assert.equal(different.length,2);
    const latest=await repo.getEventParticipationForm(event.id);
    const same=input('a',latest),other={...same,requestId:crypto.randomUUID()};
    const race=await Promise.allSettled([repo.submitParticipation(event.id,same),peer.submitParticipation(event.id,other)]);
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(race.find(r=>r.status==='rejected').reason.code,'PARTICIPATION_CHANGED');
    const retry=input('b',await repo.getEventParticipationForm(event.id));
    const replay=await Promise.all([repo.submitParticipation(event.id,retry),peer.submitParticipation(event.id,retry)]);
    assert.deepEqual(replay[0],replay[1]);
    await assert.rejects(repo.submitParticipation(event.id,{...retry,expectedParticipant:undefined,requestId:crypto.randomUUID()}));
    const pending=input('a',await repo.getEventParticipationForm(event.id));
    event=await repo.updateEvent(event.id,{...event,title:'新標題'});
    assert.equal((await repo.submitParticipation(event.id,pending)).status,'leave');
    const cancel={source:'member',id:'a',revision:(await repo.getEventParticipationForm(event.id)).responses.find(r=>r.uid==='a').revision,requestId:crypto.randomUUID()};
    const cancelled=await repo.cancelEventLeave(event.id,cancel);
    assert.deepEqual(await repo.cancelEventLeave(event.id,cancel),cancelled);
    const stale=input('b',await repo.getEventParticipationForm(event.id));
    event=await repo.updateEvent(event.id,{...event,dates:['2026-11-17']});
    await assert.rejects(repo.submitParticipation(event.id,stale),{code:'EVENT_UNAVAILABLE'});
    const video={name:'a',professionId:1,firstUrl:'https://example.test/video',secondUrl:'',groupName:VIDEO_GROUPS[0],note:'',requestId:crypto.randomUUID()};
    assert.ok(await repo.submitEventVideo(event.id,video));
    event=await repo.updateEvent(event.id,{...event,type:'activity'});
    await assert.rejects(repo.submitParticipation(event.id,{...stale,requestId:crypto.randomUUID()}),{code:'EVENT_UNAVAILABLE'});
    await assert.rejects(repo.submitEventVideo(event.id,{...video,requestId:crypto.randomUUID()}),{code:'EVENT_UNAVAILABLE'});
    await repo.deleteEvent(event.id,event.revision);
    await assert.rejects(repo.submitParticipation(event.id,{...stale,requestId:crypto.randomUUID()}),{code:'EVENT_UNAVAILABLE'});
  } finally { await repo.close(); }
});
