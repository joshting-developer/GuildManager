import { participationTarget } from '../../src/domain/participation-target.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withApp} from '../helpers/mysql-app.js';

test('attendance HTTP protects roles/CSRF, returns private history only to management and public care only on successful leave',async()=>withApp(async app=>{
 const admin=await app.admin();
 const managerCredentials={username:'attendance_manager',password:'manager-password'};
 await app.repository.createManager(admin.session.user.id,managerCredentials);const manager=await app.login(managerCredentials);
 await app.repository.setMemberToken(admin.session.user.id,{password:'member123',revision:0});const member=await app.login({password:'member123'},{path:'/auth/member-login'});
 for(const path of ['/attendance?month=2026-11','/attendance?month=2026-11&groupBy=member','/attendance/options?month=2026-11','/attendance/calendar?month=2026-11']){
  assert.equal((await app.request(path)).status,401);assert.equal((await member.request(path)).status,403);assert.equal((await manager.request(path)).status,200);
 }
 assert.equal((await manager.request('/admin/leave-settings')).status,403);
 const settings=(await(await admin.request('/admin/leave-settings')).json()).settings;
 assert.equal((await admin.request('/admin/leave-settings','PATCH',{...settings,threshold:1,message:'辛苦了, 好好休息'})).status,200);
 await app.repository.addMember({uid:'001',name:'成員甲',primaryProfessionId:1,isInGuild:true,isInClub:true});const event=await app.repository.createEvent({title:'測試活動',type:'scrimmage',dates:['2026-11-18'],requestId:'http-event'});
 const participation=await app.repository.getEventParticipationForm(event.id);
 const leave=await app.request(`/events/${event.id}/participation`,'POST',{name:'成員甲',memberUid:'001',status:'leave',note:'休息',expectedParticipant:{person:participationTarget({name:'成員甲',memberUid:'001',status:'leave'},participation)},requestId:'http-leave'});
 assert.equal(leave.status,200);const saved=await leave.json();assert.deepEqual(saved.care,{message:'辛苦了, 好好休息'});assert.equal(saved.monthlyLeaveCount,undefined);
 const input={eventId:event.id,date:'2026-11-18',uid:'001',status:'absent',note:'',revision:0,requestId:'http-attendance'};
 assert.equal((await app.request('/attendance','PATCH',input,{Cookie:manager.headers.Cookie})).status,403);
 assert.equal((await member.request('/attendance','PATCH',input)).status,403);
 assert.equal((await manager.request('/attendance','PATCH',input)).status,200);
 assert.equal((await member.request('/attendance/members/001/leaves')).status,403);
 assert.equal((await manager.request('/attendance/members/001/leaves')).status,200);
 const history=await(await manager.request('/attendance?month=2026-11&uid=001')).json();assert.equal(history.rows[0].response,'leave');assert.equal(history.rows[0].attendance,'absent');assert.equal(history.rows[0].monthlyLeaveCount,1);assert.equal(history.summary.leave,1);
 const grouped=await(await manager.request('/attendance?month=2026-11&groupBy=member')).json();assert.equal(grouped.total,1);assert.equal(grouped.rows[0].uid,'001');
 const leaves=await(await manager.request('/attendance/members/001/leaves')).json();assert.equal(leaves.rows[0].revision,1);
 const cancel={id:'001',source:'member',revision:1,requestId:'http-drawer-cancel'};
 assert.equal((await member.request(`/events/${event.id}/attendance`,'PATCH',cancel)).status,403);
 assert.equal((await app.request(`/events/${event.id}/attendance`,'PATCH',cancel,{Cookie:manager.headers.Cookie})).status,403);
 assert.equal((await manager.request(`/events/${event.id}/attendance`,'PATCH',cancel)).status,200);
 assert.equal((await(await manager.request('/attendance?month=2026-11&groupBy=member')).json()).total,0);
 assert.equal((await manager.request('/attendance?month=not-a-month')).status,422);
 await manager.request('/auth/logout','POST',{});assert.equal((await manager.request('/attendance','PATCH',input)).status,401);
}));
