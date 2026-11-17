import { sessionFetch } from './session.js';
export function createAttendanceClient({ fetchImpl = sessionFetch } = {}) {
  async function call(path, method = 'GET', input) {
    let response;
    try { response = await fetchImpl('/api/' + path, { method, ...(input ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}) }); }
    catch { throw new Error('無法連線, 請稍後重試'); }
    let data;
    try { data = await response.json(); } catch { throw new Error('資料回應格式不正確'); }
    if (!response.ok) throw new Error(data.error?.message || '無法完成出勤操作');
    return data;
  }
  const query = input => new URLSearchParams(Object.entries(input).filter(([,v]) => v !== null && v !== undefined && v !== '')).toString();
  return {
    getSettings: () => call('admin/leave-settings'),
    saveSettings: input => call('admin/leave-settings', 'PATCH', input),
    getCalendar: month => call('attendance/calendar?' + query({month})),
    getMemberHistory: (uid,page=1) => call('attendance/members/' + encodeURIComponent(uid) + '/leaves?' + query({page})),
    getOptions: month => call('attendance/options?' + query({month})),
    getHistory: input => call('attendance?' + query(input)),
    saveAttendance: input => call('attendance', 'PATCH', input),
  };
}
