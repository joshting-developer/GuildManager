export const ATTENDANCE_STATUSES = [
  { value: 'present', title: '已到場' },
  { value: 'absent', title: '未到場' },
  { value: 'unrecorded', title: '未登記' },
];
export function attendanceMonth(value) {
  if (typeof value !== 'string' || !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(value)) throw new Error('請選擇有效月份');
  const [year, month] = value.split('-').map(Number);
  return { start: value + '-01', end: month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01` };
}
