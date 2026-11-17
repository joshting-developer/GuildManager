import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseError } from '../database/mysql.js';

const numeric = new Set(['revision', 'version', 'expires_at', 'expiresAt', 'count', 'total', 'member_count', 'attendance_rate', 'pending_registrations', 'registered', 'capacity', 'created_order']);
function rows(result) {
  return result.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (numeric.has(key) && value !== null) {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new DatabaseError('DATABASE_UNSAFE_INTEGER', '資料庫數值超出安全範圍');
      return [key, number];
    }
    return [key, value];
  })));
}

export function createStore(database) {
  const transactions = new AsyncLocalStorage();
  const requests = new AsyncLocalStorage();
  async function transaction(work, readOnly = false) {
    if (transactions.getStore()) return work();
    return database.transaction(async (connection) => {
      if (!readOnly) {
        const lock = await connection.query('SELECT id FROM repository_write_lock WHERE id=1 FOR UPDATE');
        if (lock.length !== 1) throw new DatabaseError('DATABASE_SCHEMA_REQUIRED', '資料庫尚未完成必要版本更新');
      }
      return transactions.run(connection, work);
    }, { readOnly });
  }
  async function query(sql, parameters) { return (transactions.getStore() || database).query(sql, parameters); }
  return {
    transaction: (work) => transaction(work),
    read: (work) => transaction(work, true),
    write: (work) => transaction(work),
    async memberColumns() {
      return query('SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', ['members']);
    },
    prepare(sql) {
      const args = (values) => values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
      return {
        async all(...values) { return rows(await query(sql, args(values))); },
        async get(...values) { return rows(await query(sql, args(values)))[0]; },
        async run(...values) {
          return transaction(async () => {
            const result = await query(sql, args(values));
            return { changes: result.affectedRows, insertId: result.insertId };
          });
        },
      };
    },
    notify(notice) {
      const context = requests.getStore();
      if (!context) throw new Error('Notification requires an operation context');
      context.notices.push(notice);
    },
    async operation(work) {
      return requests.run({ notices: [] }, async () => {
        const data = await work();
        return { data, notifications: requests.getStore().notices };
      });
    },
  };
}

export function exposeRepository(implementation, store, database) {
  // Explicitly audited operations: none may mutate business or session rows.
  const readOnly = new Set([
    'getMember', 'getAccountSettings', 'getMemberTokenSettings', 'getEvent', 'listEvents',
    'listDuties', 'getEventAttendance', 'participationRequiresLogin',
    'listEventParticipationMembers', 'getEventParticipation', 'listEventVideos',
    'getLineupEvents', 'getLineupTemplates', 'getLineupCurrent', 'getLineupIndex',
    'getLineupHistory', 'applyLineupTemplate', 'getBattleUploadRoster', 'previewBattleMemberSync',
    'listBattleRecords', 'getBattleMetadata', 'getBattleRecord', 'getBattleTeamAnalysis',
    'getMemberBattleRecords', 'getBattleAttachment', 'getMemberMaintenance',
    'getPlatformSettings', 'getLottery', 'getLineupEditor', 'getLineupCatalogs',
    'getLineupSources', 'getLineupEvent', 'getVideoBrowser', 'getEventVideoForm',
    'getEventParticipationForm', 'previewMemberImport', 'listProfessions',
    'listParticipationMembers', 'listMembers', 'readHome',
    'getLeaveSettings', 'getLeaveCare', 'getAttendanceOptions', 'getAttendanceHistory', 'getLeaveCalendar', 'getMemberLeaveHistory',
  ]);
  const forceTransaction = new Set(['getSession', 'revokeSession', 'backfillMemberBattleRecords']);
  const invoke = async (name, args = []) => {
    if (!Object.hasOwn(implementation, name) || typeof implementation[name] !== 'function') throw new Error('Unknown repository operation');
    return store.operation(() => readOnly.has(name)
      ? store.read(() => implementation[name](...args))
      : forceTransaction.has(name) ? store.write(() => implementation[name](...args)) : implementation[name](...args));
  };
  return {
    ...Object.fromEntries(Object.keys(implementation).map((name) => [name, async (...args) => (await invoke(name, args)).data])),
    invoke,
    probe: () => database.probe(),
    close: () => database.close(),
  };
}
