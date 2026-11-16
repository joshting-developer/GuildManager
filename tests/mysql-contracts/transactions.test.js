import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository, repositoryDatabase } from '../helpers/mysql-repository.js';
import { createMysqlRepository } from '../../server/mysql/repository.js';
import { fixtureCsv } from '../helpers/gas-runtime.js';
import { participationTarget } from '../../src/domain/participation-target.js';

const person = (uid, name = uid) => ({ uid, name, primaryProfessionId: 1 });
const arrangement = (requestId) => ({ title: requestId, type: 'scrimmage', dates: ['2026-11-16'], requestId });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

// Inject at an actual transaction boundary; the real MySQL connection still rolls back.
function failingRepository(database, shouldFail) {
  return createMysqlRepository({
    ...database,
    transaction: (work, options) => database.transaction((connection) => work({
      query(sql, parameters) {
        if (shouldFail(sql)) throw new Error('synthetic failure');
        return connection.query(sql, parameters);
      },
    }), options),
  });
}

test('independent repository instances serialize conflicting edits and preserve both independent participants', async () => {
  const repo = await createTestRepository();
  const other = createMysqlRepository(repositoryDatabase(repo));
  try {
    const original = await repo.addMember(person('001'));
    await repo.addMember(person('002'));
    const results = await Promise.allSettled([
      repo.updateMember('001', { name: 'first', primaryProfessionId: 1, revision: original.revision }),
      other.updateMember('001', { name: 'second', primaryProfessionId: 1, revision: original.revision }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'STALE_MEMBER');
    const event = await repo.createEvent(arrangement('parallel-event'));
    const form = await repo.getEventParticipationForm(event.id);
    const input = (uid) => {
      const member = form.members.find((row) => row.uid === uid);
      const value = { name: member.name, memberUid: uid, status: 'leave', note: '', revision: form.revision, requestId: `leave-${uid}` };
      value.expectedParticipant = { eventRevision: event.revision, person: participationTarget(value, form) };
      return value;
    };
    const values = ['001', '002'].map(input);
    const saved = await Promise.all(values.map((value, index) => (index ? other : repo).submitParticipation(event.id, value)));
    assert.ok(saved.every((value) => value.status === 'leave'));
    assert.equal((await repo.getEventAttendance(event.id)).leave.length, 2);
    const retries = await Promise.all([repo.submitParticipation(event.id, values[0]), other.submitParticipation(event.id, values[0])]);
    assert.deepEqual(retries[0], retries[1]);
    await assert.rejects(other.submitParticipation(event.id, { ...values[0], requestId: 'stale' }), { code: 'PARTICIPATION_CHANGED' });
  } finally { await repo.close(); }
});

test('a reader sees committed data while a different connection holds the repository write lock', async () => {
  const repo = await createTestRepository();
  const database = repositoryDatabase(repo);
  const entered = deferred(), finish = deferred();
  let held;
  try {
    await repo.addMember(person('001', 'committed'));
    held = database.transaction(async (connection) => {
      await connection.query('SELECT id FROM repository_write_lock WHERE id=1 FOR UPDATE');
      await connection.query('UPDATE members SET name=? WHERE uid=?', ['uncommitted', '001']);
      entered.resolve();
      await finish.promise;
    });
    await entered.promise;
    let timer;
    try {
      const read = await Promise.race([
        repo.listMembers(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('read blocked by writer')), 2000); }),
      ]);
      assert.equal(read.members[0].name, 'committed');
    } finally { clearTimeout(timer); }
    finish.resolve();
    await held;
    assert.equal((await repo.listMembers()).members[0].name, 'uncommitted');
  } finally { finish.resolve(); await held; await repo.close(); }
});

test('failed member writes roll back history and notices, and concurrent request notices remain isolated', async () => {
  const repo = await createTestRepository();
  const database = repositoryDatabase(repo);
  try {
    await repo.addMember(person('001', 'original'));
    const broken = failingRepository(database, (sql) => sql.startsWith('UPDATE members SET name'));
    await assert.rejects(broken.invoke('updateMember', ['001', { name: 'failed', primaryProfessionId: 1, revision: 1 }]), /synthetic failure/);
    const original = (await repo.listMembers()).members[0];
    assert.equal(original.name, 'original');
    assert.equal(original.revision, 1);
    assert.deepEqual(original.previousNames, []);
    const results = await Promise.all([
      repo.invoke('addMember', [person('002', 'second')]),
      repo.invoke('addMember', [person('003', 'third')]),
    ]);
    for (const [index, result] of results.entries()) {
      assert.equal(result.notifications.length, 1);
      assert.equal(result.notifications[0].member.uid, `00${index + 2}`);
    }
    assert.deepEqual((await repo.invoke('listMembers')).notifications, []);
  } finally { await repo.close(); }
});

test('batch and maintenance failures roll back affected rows and retry receipts, then the original request can succeed', async () => {
  const repo = await createTestRepository();
  const database = repositoryDatabase(repo);
  try {
    let inserts = 0;
    const batchRepo = failingRepository(database, (sql) => /INSERT INTO scheduled_events/.test(sql) && ++inserts === 2);
    const batch = { type: 'guild_war', title: '', dates: ['2026-11-16', '2026-11-17'], requestId: 'atomic-batch' };
    await assert.rejects(batchRepo.createEventBatch(batch), /synthetic failure/);
    assert.deepEqual((await repo.listEvents()).events, []);
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM event_batches'))[0].count), 0);
    assert.equal((await repo.createEventBatch(batch)).length, 2);
    await repo.addMember(person('001'));
    const broken = failingRepository(database, (sql) => sql.startsWith('INSERT INTO member_maintenance_requests'));
    const edit = { newUid: '000000000000001', name: 'renamed', primaryProfessionId: 1, secondaryProfessionId: null, revision: 1, requestId: 'atomic-maintain' };
    await assert.rejects(broken.maintainMember('001', edit), /synthetic failure/);
    assert.equal((await repo.getMemberMaintenance('001')).member.revision, 1);
    await assert.rejects(repo.getMemberMaintenance(edit.newUid), { code: 'MEMBER_NOT_FOUND' });
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM member_maintenance_requests'))[0].count), 0);
    assert.equal((await repo.maintainMember('001', edit)).member.uid, edit.newUid);
  } finally { await repo.close(); }
});

test('notifications belong to one committed operation and failed transactions never leak notices or replay writes', async () => {
  const repo = await createTestRepository();
  const database = repositoryDatabase(repo);
  try {
    const operations = await Promise.all([
      repo.invoke('addMember', [person('001', 'first')]),
      repo.invoke('addMember', [person('002', 'second')]),
    ]);
    assert.deepEqual(operations.map((result) => result.notifications.map((notice) => notice.member.uid)), [['001'], ['002']]);
    assert.deepEqual((await repo.invoke('listMembers')).notifications, []);
    let attempts = 0;
    const broken = createMysqlRepository({
      ...database,
      transaction: (work, options) => database.transaction(async (connection) => {
        attempts++;
        await work(connection);
        throw new Error('synthetic pre-commit failure');
      }, options),
    });
    await assert.rejects(broken.invoke('addMember', [person('003', 'failed')]), /synthetic pre-commit failure/);
    assert.equal(attempts, 1);
    assert.deepEqual((await repo.listMembers()).members.map((member) => member.uid), ['001', '002']);
    assert.deepEqual((await repo.invoke('listMembers')).notifications, []);
    const succeeded = await repo.invoke('addMember', [person('003', 'retry')]);
    assert.deepEqual(succeeded.notifications.map((notice) => notice.member.name), ['retry']);
    await database.query('DELETE FROM repository_write_lock WHERE id=1');
    await assert.rejects(repo.addMember(person('004')), { code: 'DATABASE_SCHEMA_REQUIRED' });
    assert.equal((await repo.listMembers()).members.length, 3);
  } finally { await repo.close(); }
});

test('a failed player-link insert rolls back the entire upload and remains retryable with its original requestId', async () => {
  const repo = await createTestRepository();
  const database = repositoryDatabase(repo);
  try {
    await repo.addMember(person('001', '城'));
    const input = { requestId: 'rollback-battle-links', records: [{ type: 'scrimmage', filename: 'synthetic.csv',
      csvText: fixtureCsv(), datetime: '2026-11-16', redTeam: '紅', blueTeam: '藍' }] };
    const broken = failingRepository(database, (sql) => sql.startsWith('INSERT INTO battle_player_links'));
    await assert.rejects(broken.saveBattleRecords(input), /synthetic failure/);
    for (const table of ['battle_uploads', 'battle_records', 'battle_player_links']) {
      assert.equal(Number((await database.query(`SELECT COUNT(*) AS count FROM ${table}`))[0].count), 0);
    }
    const saved = await repo.saveBattleRecords(input);
    assert.equal(saved.records.length, 1);
    assert.equal((await repo.getMemberBattleRecords('001')).total, 1);
    assert.deepEqual(await repo.saveBattleRecords(input), saved);
  } finally { await repo.close(); }
});

test('member reads stay within their documented query budget and single-member history remains scoped', async () => {
  const repo = await createTestRepository();
  const database = repositoryDatabase(repo);
  try {
    await repo.addMember(person('001', 'first'));
    await repo.addMember(person('002', 'second'));
    const queries = [];
    const observed = createMysqlRepository({
      ...database,
      transaction: (work, options) => database.transaction((connection) => work({
        query(sql, parameters) {
          queries.push({ sql, parameters });
          return connection.query(sql, parameters);
        },
      }), options),
    });
    assert.equal((await observed.listMembers()).members.length, 2);
    assert.equal(queries.length, 2);
    assert.ok(queries.every(({ sql }) => !sql.includes('FOR UPDATE')));
    queries.length = 0;
    assert.equal((await observed.getMember('001')).uid, '001');
    assert.equal(queries.length, 2);
    assert.deepEqual(queries.map(({ parameters }) => parameters), [['001'], ['001']]);
    queries.length = 0;
    assert.equal((await observed.listProfessions()).professions.length, 9);
    assert.equal(queries.length, 1);
  } finally { await repo.close(); }
});

test('guest removal rejects stale/cross-event operations and keeps ASCII-only name matching', async () => {
  const repo = await createTestRepository();
  try {
    const event = await repo.createEvent(arrangement('guest-removal'));
    const other = await repo.createEvent(arrangement('other-event'));
    assert.equal(await repo.participationRequiresLogin(event.id), false);
    const guest = await repo.addGuestRegistration(event.id, { name: 'Alpha', professionId: 3, requestId: 'guest-one' });
    await assert.rejects(repo.addGuestRegistration(event.id, { name: 'aLPHa', professionId: 3, requestId: 'guest-two' }), { code: 'REGISTRATION_EXISTS' });
    for (const [index, name] of ['É', 'é'].entries()) {
      await repo.addGuestRegistration(event.id, { name, professionId: 3, requestId: `unicode-${index}` });
    }
    await assert.rejects(repo.deleteGuestRegistration(other.id, guest.id, guest.revision), { code: 'REGISTRATION_NOT_FOUND' });
    await assert.rejects(repo.deleteGuestRegistration(event.id, guest.id, guest.revision + 1), { code: 'PARTICIPATION_CHANGED' });
    const result = await repo.invoke('deleteGuestRegistration', [event.id, guest.id, guest.revision]);
    assert.deepEqual(result, { data: { deleted: true, id: guest.id }, notifications: [] });
    assert.deepEqual(await repo.deleteGuestRegistration(event.id, guest.id, guest.revision), result.data);
    const participation = await repo.getEventParticipation(event.id);
    assert.equal(participation.registrations.length, 2);
    assert.equal(participation.registrationLeaves.length, 0);
    await repo.addMember(person('001'));
    await repo.addMember({ ...person('external'), isInGuild: false, isInClub: false });
    assert.equal((await repo.listParticipationMembers()).members.length, 2);
    assert.deepEqual((await repo.listEventParticipationMembers(event.id)).members.map((member) => member.uid), ['001']);
    assert.equal((await repo.getLineupCurrent(event.id)).versions.length, 0);
    assert.equal((await repo.getLineupCatalogs()).professions.length, 9);
  } finally { await repo.close(); }
});

test('battle deletion checks metadata revision, removes member links and safely repeats without restoring a deleted upload', async () => {
  const repo = await createTestRepository();
  const database = repositoryDatabase(repo);
  try {
    await repo.addMember(person('001', '城'));
    const input = { requestId: 'delete-battle', records: [{ type: 'scrimmage', filename: 'synthetic.csv',
      csvText: fixtureCsv(), datetime: '2026-11-16', redTeam: '紅', blueTeam: '藍' }] };
    const record = (await repo.saveBattleRecords(input)).records[0];
    const metadata = await repo.getBattleMetadata(record.id);
    assert.equal(metadata.revision, 0);
    assert.equal(Object.hasOwn(metadata, 'players'), false);
    await assert.rejects(repo.deleteBattleRecord(record.id, 1), { code: 'REVISION_CONFLICT' });
    const result = await repo.deleteBattleRecord(record.id, 0);
    assert.deepEqual(await repo.deleteBattleRecord(record.id, 0), result);
    assert.equal((await repo.getMemberBattleRecords('001')).total, 0);
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM battle_player_links'))[0].count), 0);
    await assert.rejects(repo.getBattleMetadata(record.id), { code: 'BATTLE_NOT_FOUND' });
    assert.deepEqual(await repo.saveBattleRecords(input), { records: [] });
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM battle_uploads'))[0].count), 1);
  } finally { await repo.close(); }
});
