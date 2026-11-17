import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestRepository,repositoryDatabase} from '../helpers/mysql-repository.js';
const access={assertAccess:async()=>({id:'manager-test'})};
async function setup(){
 const repo=await createTestRepository();await repo.addMember({uid:'001',name:'成員甲',primaryProfessionId:1,isInGuild:true,isInClub:true});
 const events=[];for(const [i,date] of ['2026-11-01','2026-11-02','2026-11-03','2026-12-01'].entries())events.push(await repo.createEvent({title:'測試場'+i,type:'scrimmage',dates:[date],requestId:'e'+i}));
 return {repo,events};
}
test('care counts only effective leaves in the event month, excludes cancelled events and retains idempotent results',async()=>{
 const {repo,events}=await setup();try{
  const settings=(await repo.getLeaveSettings()).settings;assert.equal(settings.threshold,3);
  await repo.saveLeaveSettings({...settings,threshold:2,message:'記得休息'},access);
  const leave=async(i,key)=>repo.submitParticipation(events[i].id,{name:'成員甲',memberUid:'001',status:'leave',note:'測試原因',revision:(await repo.getEventParticipation(events[i].id)).revision,requestId:key});
  assert.equal((await leave(0,'leave-a')).care,undefined);
  const input={name:'成員甲',memberUid:'001',status:'leave',note:'測試原因',revision:(await repo.getEventParticipation(events[1].id)).revision,requestId:'leave-b'};
  const result=await repo.submitParticipation(events[1].id,input);assert.equal(result.care.message,'記得休息');assert.deepEqual(await repo.submitParticipation(events[1].id,input),result);
  assert.equal((await leave(3,'dec-leave')).care,undefined);
  await repo.saveMemberResponse(events[0].id,{uid:'001',status:'none',note:'',revision:1});assert.equal(await repo.getLeaveCare(events[1].id,'001'),null);
  await repo.deleteEvent(events[1].id,events[1].revision);assert.equal(await repo.getLeaveCare(events[0].id,'001'),null);
 }finally{await repo.close();}
});
test('attendance stores actual presence separately, scopes history in SQL and protects revisions, retries and actors',async()=>{
 const {repo,events}=await setup();try{
  await repo.saveMemberResponse(events[0].id,{uid:'001',status:'leave',note:'請假原因',revision:0});
  const input={eventId:events[0].id,date:'2026-11-01',uid:'001',status:'present',note:'有到場',revision:0,requestId:'attendance-a'};
  const result=await repo.saveAttendance(input,access);assert.deepEqual(await repo.saveAttendance(input,access),result);
  await assert.rejects(()=>repo.saveAttendance({...input,requestId:'stale'},access),e=>e.code==='STALE_ATTENDANCE');
  await assert.rejects(()=>repo.saveAttendance(input,{assertAccess:async()=>({id:'other'})}),e=>e.code==='REQUEST_CONFLICT');
  await assert.rejects(()=>repo.saveAttendance({...input,date:'2026-11-04',requestId:'wrong-date'},access),e=>e.code==='ATTENDANCE_UNAVAILABLE');
  const page=await repo.getAttendanceHistory({month:'2026-11',uid:'001'});assert.equal(page.total,1);assert.equal(page.rows[0].attendance,'present');assert.equal(page.rows[0].response,'leave');assert.equal(page.rows[0].leaveNote,'請假原因');
  assert.equal((await repo.getAttendanceHistory({month:'2026-12'})).rows.length,0);
  assert.equal((await repo.getAttendanceHistory({month:'2026-11',eventId:events[2].id})).rows.length,0);
  await assert.rejects(()=>repo.getAttendanceHistory({month:'2026-13'}));
  const attempts=await Promise.allSettled(['a','b'].map(key=>repo.saveAttendance({...input,status:'absent',revision:1,requestId:'parallel-'+key},access)));assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
 }finally{await repo.close();}
});
test('settings refuse stale overwrites and attendance survives UID correction then respects permanent deletion',async()=>{
 const {repo,events}=await setup();try{
  const settings=(await repo.getLeaveSettings()).settings;await repo.saveLeaveSettings({...settings,threshold:4},access);
  await assert.rejects(()=>repo.saveLeaveSettings({...settings,threshold:5},access),e=>e.code==='STALE_SETTINGS');
  await assert.rejects(()=>repo.saveLeaveSettings({...settings,threshold:101},access));
  await repo.saveAttendance({eventId:events[0].id,date:'2026-11-01',uid:'001',status:'absent',note:'',revision:0,requestId:'record'},access);
  await repo.maintainMember('001',{newUid:'002',name:'成員甲',primaryProfessionId:1,secondaryProfessionId:null,isInGuild:true,isInClub:true,revision:1,requestId:'move-uid'});
  assert.equal((await repo.getAttendanceHistory({month:'2026-11',uid:'002'})).rows[0].uid,'002');
  await repo.deleteMemberPermanently('002',{revision:2,requestId:'delete-uid',confirmUid:'002'});
  const db=repositoryDatabase(repo);assert.equal(Number((await db.query('SELECT COUNT(*) AS count FROM attendance_records'))[0].count),0);
 }finally{await repo.close();}
});

test('monthly history is bounded and stable across pages, member filters and unrelated months',async()=>{
 const {repo,events}=await setup();try{
  const db=repositoryDatabase(repo);
  for(let i=0;i<32;i++){
   const uid='scope-'+String(i).padStart(2,'0');
   await db.query(`INSERT INTO members (uid,name,primary_profession_id,primary_profession,joined_at,updated_at) VALUES (?,?,1,'素問','','')`,[uid,'測試'+i]);
   await db.query(`INSERT INTO event_member_responses (event_id,member_uid,status,note,revision,updated_at) VALUES (?,?,'leave','',1,'')`,[events[0].id,uid]);
   await db.query(`INSERT INTO event_member_responses (event_id,member_uid,status,note,revision,updated_at) VALUES (?,?,'leave','',1,'')`,[events[3].id,uid]);
  }
  const first=await repo.getAttendanceHistory({month:'2026-11'}),second=await repo.getAttendanceHistory({month:'2026-11',page:2});
  assert.equal(first.total,32);assert.equal(first.rows.length,25);assert.equal(second.rows.length,7);assert.equal(new Set([...first.rows,...second.rows].map(row=>row.uid)).size,32);assert.equal(first.summary.leave,32);
  const person=await repo.getAttendanceHistory({month:'2026-11',uid:'scope-01'});assert.equal(person.rows.length,1);assert.equal(person.rows[0].monthlyLeaveCount,1);
  assert.equal((await repo.getAttendanceHistory({month:'2026-11',eventId:events[1].id})).total,0);
 }finally{await repo.close();}
});

test('leave calendar deduplicates people per day and drawer history crosses months without exposing other people',async()=>{
 const {repo,events}=await setup();try{
  const db=repositoryDatabase(repo);await db.query('UPDATE event_dates SET date=? WHERE event_id=?',['2026-11-01',events[1].id]);
  for(const i of [0,1,3])await repo.saveMemberResponse(events[i].id,{uid:'001',status:'leave',note:'請假原因'+i,revision:0});
  const calendar=await repo.getLeaveCalendar('2026-11');assert.equal(calendar.days.length,1);assert.equal(calendar.days[0].count,1);assert.deepEqual(calendar.days[0].names,['成員甲']);
  const day=await repo.getAttendanceHistory({month:'2026-11',date:'2026-11-01',response:'leave'});assert.equal(day.total,2);assert.equal(day.rows.length,2);
  assert.equal((await repo.getAttendanceHistory({month:'2026-11',date:'2026-11-02',response:'leave'})).total,0);
  const history=await repo.getMemberLeaveHistory('001');assert.equal(history.total,3);assert.equal(history.rows[0].date,'2026-12-01');assert.equal(history.rows[0].note,'請假原因3');
  await assert.rejects(()=>repo.getMemberLeaveHistory('missing'),e=>e.code==='MEMBER_NOT_FOUND');
  await assert.rejects(()=>repo.getAttendanceHistory({month:'2026-11',date:'2026-12-01',response:'leave'}));
 }finally{await repo.close();}
});
