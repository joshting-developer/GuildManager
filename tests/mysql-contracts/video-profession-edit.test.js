import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository as createRepository, repositoryDatabase } from '../helpers/mysql-repository.js';
import { createMysqlRepository } from '../../server/mysql/repository.js';

import { videoTableCsv } from '../../src/domain/video-table-csv.js';
const submission = event => ({ name: '同名角色', professionId: 3, firstUrl: 'https://example.com/first',
  secondUrl: 'https://example.com/second', groupName: '進攻二', note: '長備註\n第二行',
  eventRevision: event.revision, requestId: crypto.randomUUID() });
const input = (extra = {}) => ({ professionId: 4, revision: 0, requestId: crypto.randomUUID(), ...extra });
const unchanged = ({ professionId, professionName, professionColorcode, revision, ...rest }) => rest;
async function exercise({ get, update, submit, unavailable }, event, other, saved, uploaded) {
  const original = saved.video, sameName = (await submit(event.id, { ...uploaded, requestId: crypto.randomUUID() })).video;
  const patch = input();
  const changed = (await update(event.id, original.id, patch)).video;
  assert.equal(changed.professionId, 4);
  assert.equal(changed.revision, 1);
  assert.deepEqual(unchanged(changed), unchanged(original));
  assert.ok(changed.professionName && changed.professionColorcode);
  assert.equal((await get(event.id)).videos.find(row => row.id === sameName.id).professionId, 3);
  assert.deepEqual((await update(event.id, original.id, patch)).video, changed);
  assert.deepEqual((await submit(event.id, uploaded)), saved); // Original upload receipt does not revert correction.
  assert.deepEqual((await get(event.id)).videos.find(row => row.id === original.id), changed);
  assert.ok(videoTableCsv([changed]).includes(changed.professionName));
  (await assert.rejects(async () => (await update(event.id, original.id, { ...patch, professionId: 5 })), { code: 'REQUEST_CONFLICT' }));
  (await assert.rejects(async () => (await update(event.id, original.id, input())), { code: 'REVISION_CONFLICT' }));
  (await assert.rejects(async () => (await update(other.id, original.id, input())), { code: 'VIDEO_NOT_FOUND' }));
  (await assert.rejects(async () => (await update(event.id, 'missing', input())), { code: 'VIDEO_NOT_FOUND' }));
  for (const bad of [{ professionId: 999 }, { professionId: '4' }, { professionId: null }, { revision: -1 },
    { revision: 0.5 }, { requestId: '' }, { requestId: 'bad:id' }, { note: 'not editable' }, { firstUrl: 'https://example.com/overwrite' }])
    (await assert.rejects(async () => (await update(event.id, original.id, input({ revision: 1, ...bad }))), { code: 'VIDEO_INVALID' }));
  const second = (await update(event.id, original.id, input({ professionId: 5, revision: 1 }))).video;
  assert.equal(second.revision, 2);
  assert.deepEqual(unchanged(second), unchanged(original));
  (await unavailable(event));
  (await assert.rejects(async () => (await update(event.id, original.id, input({ revision: 2 }))), { code: 'EVENT_UNAVAILABLE' }));
}

test('MySQL video profession corrections preserve metadata and upload receipts for every battle type', async () => {
 const repo=await createRepository();
 try {
  const other=await repo.createEvent({type:'scrimmage',title:'other',dates:['2026-11-17'],requestId:'other'});
  for(const type of ['scrimmage','guild_war','dragon_tiger']) {
   const event=await repo.createEvent({type,title:type,dates:['2026-11-16'],requestId:type});
   const uploaded=submission(event),saved=await repo.submitEventVideo(event.id,uploaded);
   await exercise({get:repo.listEventVideos,update:repo.updateEventVideoProfession,submit:repo.submitEventVideo,unavailable:async e=>(await repo.deleteEvent(e.id,e.revision))},event,other,saved,uploaded);
  }
 } finally {await repo.close();}
});
test('MySQL legacy video corrections roll back receipt failures and keep original link rows intact',async()=>{
 const repo=await createRepository(),database=repositoryDatabase(repo);
 try {
  const event=await repo.createEvent({type:'scrimmage',title:'legacy',dates:['2026-11-16'],requestId:'legacy'});
  await database.query('INSERT INTO event_videos(id,event_id,round_number,name,url,group_name,created_at) VALUES(?,?,?,?,?,?,?)',['legacy',event.id,2,'old','https://example.test/video','防守團','2026-11-16T00:00:00Z']);
  const rows=await database.query('SELECT * FROM event_videos');
  const before=(await repo.listEventVideos(event.id)).videos[0],patch=input();
  assert.equal(before.professionId,null);assert.equal(before.revision,0);
  const broken=createMysqlRepository({...database,transaction:(work,options)=>database.transaction(async connection=>(await work({query(sql,args){
   if(sql.startsWith('INSERT INTO event_video_profession_requests')) throw new Error('synthetic receipt failure');
   return connection.query(sql,args);
  }})),options)});
  await assert.rejects((broken.updateEventVideoProfession(event.id,'legacy',patch)),/synthetic receipt failure/);
  assert.deepEqual((await repo.listEventVideos(event.id)).videos[0],before);
  const result=await repo.updateEventVideoProfession(event.id,'legacy',patch);
  assert.deepEqual(unchanged(result.video),unchanged(before));
  assert.deepEqual(await repo.updateEventVideoProfession(event.id,'legacy',patch),result);
  assert.deepEqual((await createMysqlRepository(database).listEventVideos(event.id)).videos[0],result.video);
  assert.deepEqual(await database.query('SELECT * FROM event_videos'),rows);
 }finally{await repo.close();}
});
