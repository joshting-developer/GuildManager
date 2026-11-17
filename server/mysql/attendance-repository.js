import { createHash } from 'node:crypto';
import { attendanceMonth, ATTENDANCE_STATUSES } from '../../src/domain/attendance.js';
import { ParticipationError } from '../participation-repository.js';

const fail = (message, status = 422, code = 'INVALID_ATTENDANCE') => { throw new ParticipationError(message, status, code); };
function monthRange(month) { try { return attendanceMonth(month); } catch { fail('請選擇有效月份'); } }
function identifier(value, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.length || value.length > 64 || /[\u0000-\u001f\u007f]/.test(value)) fail('人員或場次資料不正確');
  return value;
}
// Only real responses and explicitly recorded attendance belong in history; no inferred absences.
const history = `WITH people AS (
  SELECT r.event_id,d.date,r.member_uid FROM event_member_responses r JOIN event_dates d ON d.event_id=r.event_id WHERE r.status IN ('registered','leave')
  UNION SELECT event_id,event_date AS date,member_uid FROM attendance_records
) `;
const historyFrom = `FROM people x JOIN scheduled_events e ON e.id=x.event_id JOIN members m ON m.uid=x.member_uid
 LEFT JOIN event_member_responses r ON r.event_id=x.event_id AND r.member_uid=x.member_uid AND EXISTS (SELECT 1 FROM event_dates ed_current WHERE ed_current.event_id=x.event_id AND ed_current.date=x.date)
 LEFT JOIN attendance_records a ON a.event_id=x.event_id AND a.event_date=x.date AND a.member_uid=x.member_uid`;

export function createAttendanceRepository(db) {
  async function getLeaveSettings() {
    const row = await db.prepare('SELECT threshold,message,revision FROM leave_settings WHERE id=1').get();
    return { settings: row };
  }
  async function getLeaveCare(eventId, uid) {
    const settings = (await getLeaveSettings()).settings;
    if (!settings.threshold || !settings.message) return null;
    const date = await db.prepare('SELECT date FROM event_dates WHERE event_id=? ORDER BY date LIMIT 1').get(eventId);
    if (!date) return null;
    const range = monthRange(date.date.slice(0, 7));
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM event_member_responses r
      JOIN scheduled_events e ON e.id=r.event_id JOIN event_dates d ON d.event_id=e.id
      WHERE r.member_uid=? AND r.status='leave' AND e.deleted_at IS NULL AND d.date>=? AND d.date<?`).get(uid, range.start, range.end);
    return row.count >= settings.threshold ? { message: settings.message } : null;
  }
  return {
    getLeaveSettings, getLeaveCare,
    async saveLeaveSettings(input, access) {
      if (!Number.isSafeInteger(input?.threshold) || input.threshold < 0 || input.threshold > 100 ||
          typeof input.message !== 'string' || !input.message.trim() || [...input.message].length > 300 ||
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.message) || !Number.isSafeInteger(input.revision) || input.revision < 1) fail('門檻須為 0–100 次, 關心訊息為 1–300 字');
      return db.write(async () => {
        await access.assertAccess();
        const current = (await getLeaveSettings()).settings;
        const message = input.message.trim();
        if (input.threshold === current.threshold && message === current.message &&
            (input.revision === current.revision || input.revision + 1 === current.revision)) return { settings: current };
        if (input.revision !== current.revision) fail('設定已更新, 請重新載入', 409, 'STALE_SETTINGS');
        await db.prepare('UPDATE leave_settings SET threshold=?,message=?,revision=revision+1 WHERE id=1').run(input.threshold, message);
        return getLeaveSettings();
      });
    },
    async getAttendanceOptions(month) {
      const range = monthRange(month);
      const events = await db.prepare(`SELECT e.id,e.title,e.type,d.date FROM scheduled_events e JOIN event_dates d ON d.event_id=e.id
        WHERE e.deleted_at IS NULL AND d.date>=? AND d.date<? ORDER BY d.date DESC,e.id LIMIT 500`).all(range.start, range.end);
      const members = await db.prepare(`SELECT uid,name FROM members WHERE removed_at IS NULL ORDER BY name,uid LIMIT 1000`).all();
      return { events, members };
    },
    async getLeaveCalendar(month) {
      const range = monthRange(month);
      const base = `FROM event_member_responses r JOIN scheduled_events e ON e.id=r.event_id JOIN event_dates d ON d.event_id=e.id JOIN members m ON m.uid=r.member_uid WHERE r.status='leave' AND e.deleted_at IS NULL AND d.date>=? AND d.date<?`;
      const days = await db.prepare('SELECT d.date,COUNT(DISTINCT r.member_uid) AS count ' + base + ' GROUP BY d.date ORDER BY d.date LIMIT 31').all(range.start,range.end);
      const names = await db.prepare(`WITH people AS (SELECT DISTINCT d.date,r.member_uid,m.name ${base}), ranked AS (SELECT date,name,ROW_NUMBER() OVER(PARTITION BY date ORDER BY name,member_uid) AS sort_rank FROM people) SELECT date,name FROM ranked WHERE sort_rank<=3 ORDER BY date,sort_rank LIMIT 93`).all(range.start,range.end);
      return { month, days: days.map(day => ({...day,names:names.filter(item=>item.date===day.date).map(item=>item.name)})) };
    },
    async getMemberLeaveHistory(uid, input = {}) {
      identifier(uid);
      const page = input.page === undefined ? 1 : Number(input.page);
      if (!Number.isSafeInteger(page) || page<1 || page>400) fail('頁碼不正確');
      const member = await db.prepare('SELECT uid,name FROM members WHERE uid=?').get(uid);
      if (!member) fail('找不到這位成員',404,'MEMBER_NOT_FOUND');
      const from = `FROM event_member_responses r JOIN scheduled_events e ON e.id=r.event_id JOIN event_dates d ON d.event_id=e.id WHERE r.member_uid=? AND r.status='leave' AND e.deleted_at IS NULL`;
      const total = (await db.prepare('SELECT COUNT(*) AS total '+from).get(uid)).total;
      const rows = await db.prepare(`SELECT e.id AS eventId,e.title,e.type,d.date,r.note ${from} ORDER BY d.date DESC,e.id LIMIT 25 OFFSET ${(page-1)*25}`).all(uid);
      return {member,rows,total,page,pageSize:25};
    },
    async getAttendanceHistory(input = {}) {
      const range = monthRange(input.month), eventId = identifier(input.eventId, true), uid = identifier(input.uid, true);
      const page = input.page === undefined ? 1 : Number(input.page);
      if (!Number.isSafeInteger(page) || page < 1 || page > 400) fail('頁碼不正確');
      const date = input.date || '';
      if (date && (typeof date !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(date) || date < range.start || date >= range.end)) fail('日期不在所選月份');
      if (input.response !== undefined && input.response !== 'leave') fail('請假篩選不正確');
      const where = ' WHERE e.deleted_at IS NULL AND x.date>=? AND x.date<?' + (eventId ? ' AND x.event_id=?' : '') + (uid ? ' AND x.member_uid=?' : '') + (date ? ' AND x.date=?' : '') + (input.response === 'leave' ? " AND r.status='leave'" : '');
      const args = [range.start, range.end, ...(eventId ? [eventId] : []), ...(uid ? [uid] : []), ...(date ? [date] : [])];
      const counts = await db.prepare(history + `SELECT COUNT(*) AS total,COALESCE(SUM(r.status='leave'),0) AS leaveCount,COALESCE(SUM(a.status='present'),0) AS presentCount,COALESCE(SUM(a.status='absent'),0) AS absentCount ` + historyFrom + where).get(...args);
      const total = counts.total;
      const rows = await db.prepare(history + `SELECT x.event_id AS eventId,x.date,e.title,e.type,x.member_uid AS uid,
        COALESCE(a.member_name,m.name) AS name,COALESCE(r.status,'none') AS response,COALESCE(r.note,'') AS leaveNote,
        COALESCE(a.status,'unrecorded') AS attendance,COALESCE(a.note,'') AS note,COALESCE(a.revision,0) AS revision
        ` + historyFrom + where + ` ORDER BY x.date DESC,x.event_id,x.member_uid LIMIT 25 OFFSET ${(page - 1) * 25}`).all(...args);
      const { settings } = await getLeaveSettings();
      const uids = [...new Set(rows.map(row => row.uid))];
      const monthly = uids.length ? await db.prepare(`SELECT r.member_uid AS uid,COUNT(*) AS count FROM event_member_responses r JOIN scheduled_events e ON e.id=r.event_id JOIN event_dates d ON d.event_id=e.id WHERE r.status='leave' AND e.deleted_at IS NULL AND d.date>=? AND d.date<? AND r.member_uid IN (${uids.map(() => '?').join(',')}) GROUP BY r.member_uid LIMIT 25`).all(range.start, range.end, ...uids) : [];
      const byUid = new Map(monthly.map(row => [row.uid,row.count]));
      return { month: input.month, rows: rows.map(row => ({...row,monthlyLeaveCount:byUid.get(row.uid)||0})), total, page, pageSize: 25, threshold: settings.threshold, summary: { leave: Number(counts.leaveCount),present: Number(counts.presentCount),absent: Number(counts.absentCount) } };
    },
    async saveAttendance(input, access) {
      const eventId = identifier(input?.eventId), uid = identifier(input?.uid), requestId = identifier(input?.requestId);
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(requestId)) fail('操作識別碼不正確');
      if (typeof input.date !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(input.date) ||
          new Date(input.date + 'T00:00:00.000Z').toISOString().slice(0,10) !== input.date ||
          !ATTENDANCE_STATUSES.some(s => s.value === input.status) || !Number.isSafeInteger(input.revision) || input.revision < 0 ||
          typeof input.note !== 'string' || input.note.length > 160 || /[\u0000-\u001f\u007f]/.test(input.note)) fail('請確認日期、出勤狀態與備註');
      return db.write(async () => {
        const actor = await access.assertAccess();
        const hash = createHash('sha256').update(JSON.stringify([eventId,input.date,uid,input.status,input.note,input.revision])).digest('hex');
        const previous = await db.prepare('SELECT actor_id,input_hash,result_json FROM attendance_requests WHERE request_id=?').get(requestId);
        if (previous) {
          if (previous.actor_id !== actor.id || previous.input_hash !== hash) fail('操作識別碼已使用', 409, 'REQUEST_CONFLICT');
          return JSON.parse(previous.result_json);
        }
        const event = await db.prepare(`SELECT e.id FROM scheduled_events e JOIN event_dates d ON d.event_id=e.id
          WHERE e.id=? AND d.date=? AND e.deleted_at IS NULL`).get(eventId, input.date);
        const member = await db.prepare('SELECT name FROM members WHERE uid=? AND removed_at IS NULL').get(uid);
        if (!event || !member) fail('活動或成員已更新, 請重新載入', 409, 'ATTENDANCE_UNAVAILABLE');
        const current = await db.prepare('SELECT revision FROM attendance_records WHERE event_id=? AND event_date=? AND member_uid=?').get(eventId,input.date,uid);
        if ((current?.revision || 0) !== input.revision) fail('出勤已被更新, 請重新載入', 409, 'STALE_ATTENDANCE');
        const revision = input.revision + 1;
        await db.prepare(`INSERT INTO attendance_records VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
          status=VALUES(status),note=VALUES(note),revision=VALUES(revision),actor_id=VALUES(actor_id),updated_at=VALUES(updated_at)`)
          .run(eventId,input.date,uid,member.name,input.status,input.note,revision,actor.id,new Date().toISOString());
        const result = { eventId, date: input.date, uid, revision };
        await db.prepare('INSERT INTO attendance_requests VALUES (?,?,?,?)').run(requestId,actor.id,hash,JSON.stringify(result));
        return result;
      });
    },
  };
}
