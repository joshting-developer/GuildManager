import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository, repositoryDatabase, repositoryFileStorage } from '../helpers/mysql-repository.js';
import { createMysqlRepository } from '../../server/mysql/repository.js';
import { AuthError } from '../../server/auth-repository.js';
import { emptyLotteryBoard } from '../../src/domain/lottery.js';

test('accounts store only hashes, preserve roles and sessions across repository recreation, expire and revoke safely', async () => {
  let time = Date.now();
  const repo = await createTestRepository({ authNow: () => time });
  const database = repositoryDatabase(repo);
  const reopened = createMysqlRepository(database, { authNow: () => time });
  const credentials = { username: 'admin', password: 'synthetic-password-2026' };
  try {
    const account = await repo.createAccount(credentials);
    assert.equal(account.role, 'admin');
    await assert.rejects(repo.createAccount({ ...credentials, username: 'ADMIN' }), { code: 'ACCOUNT_EXISTS' });
    await assert.rejects(repo.authenticate({ ...credentials, password: 'wrong' }), (error) => error instanceof AuthError && error.code === 'INVALID_CREDENTIALS');
    await assert.rejects(repo.authenticate({ username: 'unknown', password: 'wrong' }), { code: 'INVALID_CREDENTIALS' });
    const auth = await repo.authenticate(credentials);
    const stored = JSON.stringify({
      accounts: await database.query('SELECT * FROM auth_accounts'),
      sessions: await database.query('SELECT * FROM auth_sessions'),
    });
    assert.equal(stored.includes(credentials.password), false);
    assert.equal(stored.includes(auth.token), false);
    assert.equal((await reopened.getSession(auth.token)).user.username, 'admin');
    const manager = await repo.createManager(account.id, { username: 'manager', password: 'manager-password' });
    const managed = await repo.authenticate({ username: manager.username, password: 'manager-password' });
    await assert.rejects(repo.getAccountSettings(manager.id), { code: 'ADMIN_REQUIRED' });
    await repo.updateManager(account.id, manager.id, { username: 'renamed', password: '', revision: manager.revision });
    assert.equal(await reopened.getSession(managed.token), null);
    await repo.setMemberToken(account.id, { password: 'member123', revision: 0 });
    const member = await reopened.authenticateMember({ password: 'member123' });
    assert.equal(member.user.role, 'member');
    assert.equal(member.user.username, '');
    await assert.rejects(repo.authenticate({ username: 'guild_member', password: 'member123' }), { code: 'INVALID_CREDENTIALS' });
    await repo.setMemberToken(account.id, { password: 'member456', revision: 1 });
    assert.equal(await reopened.getSession(member.token), null);
    await repo.revokeSession(auth.token);
    assert.equal(await reopened.getSession(auth.token), null);
    const fresh = await repo.authenticate(credentials);
    time += 8 * 60 * 60 * 1000;
    assert.equal(await reopened.getSession(fresh.token), null);
  } finally { await repo.close(); }
});

test('lottery draws once per prize, persists across instances, excludes winners and resets with revision checks', async () => {
  const repo = await createTestRepository();
  const reopened = createMysqlRepository(repositoryDatabase(repo), { fileStorage: repositoryFileStorage(repo) });
  try {
    assert.deepEqual((await repo.getLottery()).lottery, emptyLotteryBoard());
    let board = (await repo.saveLottery({ players: ['甲', '乙'], prizes: ['一獎', '二獎', '三獎'], revision: 0 })).lottery;
    const [one, two, three] = board.prizes.map((prize) => prize.id);
    const draws = await Promise.all([repo.drawLotteryPrize({ prizeId: one }), reopened.drawLotteryPrize({ prizeId: one })]);
    assert.deepEqual(draws.map((draw) => draw.draw.already).sort(), [false, true]);
    assert.equal(draws[0].draw.winner, draws[1].draw.winner);
    const second = await reopened.drawLotteryPrize({ prizeId: two });
    assert.deepEqual(second.draw.runners, ['甲', '乙'].filter((name) => name !== draws[0].draw.winner));
    await assert.rejects(repo.drawLotteryPrize({ prizeId: three }), { code: 'LOTTERY_NO_RUNNERS' });
    await assert.rejects(repo.drawLotteryPrize({ prizeId: 'missing' }), { code: 'LOTTERY_PRIZE_NOT_FOUND' });
    board = (await reopened.getLottery()).lottery;
    await assert.rejects(repo.resetLottery({ revision: board.revision - 1 }), { code: 'LOTTERY_CONFLICT' });
    const reset = (await repo.resetLottery({ revision: board.revision })).lottery;
    assert.ok(reset.prizes.every((prize) => prize.winner === null && prize.drawnAt === null));
    assert.equal((await reopened.resetLottery({ revision: reset.revision })).lottery.revision, reset.revision);
  } finally { await repo.close(); }
});

test('platform name and icon remain atomic and revision protected across repository instances', async () => {
  const repo = await createTestRepository();
  const reopened = createMysqlRepository(repositoryDatabase(repo), { fileStorage: repositoryFileStorage(repo) });
  try {
    const original = (await repo.getPlatformSettings()).platform;
    const saved = await repo.updatePlatformSettings({ name: '測試平台🌊', revision: original.revision });
    assert.equal((await reopened.getPlatformSettings()).platform.name, '測試平台🌊');
    await assert.rejects(repo.updatePlatformSettings({ name: 'stale', revision: original.revision }), { code: 'STALE_SETTINGS' });
    const icon = { mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1kAAAAASUVORK5CYII=' };
    const withIcon = await repo.updatePlatformSettings({ name: saved.platform.name, revision: saved.platform.revision, icon });
    assert.equal((await reopened.getPlatformSettings()).platform.iconSrc, `data:image/png;base64,${icon.base64}`);
    await assert.rejects(repo.updatePlatformSettings({ name: 'invalid', revision: withIcon.platform.revision, icon: { mimeType: 'image/svg+xml', base64: 'PHN2Zz4=' } }));
    assert.deepEqual(await reopened.getPlatformSettings(), withIcon);
    const cleared = await repo.updatePlatformSettings({ name: withIcon.platform.name, revision: withIcon.platform.revision, icon: null });
    assert.equal(cleared.platform.iconSrc, undefined);
  } finally { await repo.close(); }
});
