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
    // Writers lock only the rows they change; there is no repository-wide queue.
    const run = () => database.transaction((connection) => transactions.run(connection, work), { readOnly });
    if (readOnly) return run();
    const notices = requests.getStore()?.notices;
    const queued = notices?.length;
    try {
      return await run();
    } catch (error) {
      if (!['DATABASE_DUPLICATE', 'DATABASE_CONFLICT'].includes(error?.code)) throw error;
      // Losing a unique key or deadlock to a concurrent writer rolled everything back. One fresh attempt
      // sees the winner's commit and returns its requestId replay or the normal business conflict.
      if (notices) notices.length = queued;
      return run();
    }
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
    'getMember', 'getAccountSettings', 'getMemberTokenSettings', 'getEvent', 'listEvents', 'listManagedEvents',
    'listDuties', 'getEventAttendance', 'participationRequiresLogin',
    'listEventParticipationMembers', 'getEventParticipation', 'listEventVideos',
    'getLineupChoices', 'getLineupEvents', 'getLineupTemplates', 'getLineupCurrent', 'getLineupIndex',
    'getLineupHistory', 'applyLineupTemplate', 'getBattleUploadRoster', 'previewBattleMemberSync',
    'listBattleRecords', 'getBattleMetadata', 'getBattleRecord', 'getBattleTeamAnalysis',
    'getMemberBattleRecords', 'getBattleAttachment', 'getMemberMaintenance',
    'getPlatformSettings', 'getLottery', 'getLineupEditor', 'getLineupCatalogs',
    'getLineupSources', 'getLineupEvent', 'getVideoChoices', 'getVideoBrowser', 'getEventVideoForm',
    'getEventParticipationForm', 'previewMemberImport', 'listProfessions',
    'listParticipationMembers', 'listMembers',
    'getLeaveSettings', 'getLeaveCare', 'getAttendanceOptions', 'getAttendanceHistory', 'getLeaveCalendar', 'getMemberLeaveHistory',
  ]);
  // getSession reads without a transaction and only writes when it removes an expired session.
  const forceTransaction = new Set(['backfillMemberBattleRecords']);
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
