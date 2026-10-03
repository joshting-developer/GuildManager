import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createHomeClient } from '../src/api/home.js';

test('SQLite initialization preserves existing data on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guildmanager-test-'));
  const filename = join(directory, 'test.sqlite');
  try {
    let repository = createRepository({ filename });
    assert.equal(repository.readHome().events.length, 0);
    repository.close();
    const db = new Database(filename);
    db.prepare('UPDATE home_settings SET guild_name = ? WHERE id = 1').run('保留的幫會名稱');
    db.close();
    repository = createRepository({ filename });
    try {
      assert.equal(repository.readHome().guild.name, '保留的幫會名稱');
      assert.equal(repository.readHome().events.length, 0);
    } finally {
      repository.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an unseeded SQLite database contains empty data with unknown attendance', () => {
  const repository = createRepository({ filename: ':memory:' });
  try {
    const data = repository.readHome();
    assert.equal(data.meta.mode, 'empty');
    assert.equal(data.summary.attendanceRate, null);
    assert.deepEqual(data.events, []);
    assert.deepEqual(data.announcements, []);
  } finally {
    repository.close();
  }
});

test('local API returns the home contract and rejects unsupported writes', async () => {
  const repository = createRepository({ filename: ':memory:' });
  const server = createApp(repository).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const client = createHomeClient({ fetchImpl: (path) => fetch(`${base}${path}`) });
    const data = await client.getHomeData();
    assert.equal(data.meta.mode, 'empty');
    assert.equal(data.summary.upcomingEvents, null);
    assert.deepEqual(data.events, []);
    assert.equal((await fetch(`${base}/api/home`, { method: 'POST' })).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repository.close();
  }
});

test('GAS adapter resolves the same contract without an HTTP request', async () => {
  const repository = createRepository({ filename: ':memory:' });
  try {
    const data = repository.readHome();
    let success;
    const run = {
      withSuccessHandler(handler) {
        success = handler;
        return this;
      },
      withFailureHandler() {
        return this;
      },
      getHomeData() {
        success(data);
      },
    };
    const client = createHomeClient({
      source: 'gas',
      googleRun: run,
      fetchImpl: () => {
        throw new Error('HTTP must not be called');
      },
    });
    assert.deepEqual(await client.getHomeData(), data);
  } finally {
    repository.close();
  }
});

test('GAS failure rejects without falling back to demonstration data', async () => {
  let failure;
  const run = {
    withSuccessHandler() {
      return this;
    },
    withFailureHandler(handler) {
      failure = handler;
      return this;
    },
    getHomeData() {
      failure(new Error('not authorized'));
    },
  };
  await assert.rejects(
    createHomeClient({ source: 'gas', googleRun: run }).getHomeData(),
    /雲端資料讀取失敗/,
  );
});

test('local transport rejects malformed payloads and HTTP errors', async () => {
  await assert.rejects(
    createHomeClient({ fetchImpl: async () => ({ ok: false }) }).getHomeData(),
    /本機資料讀取失敗/,
  );
  await assert.rejects(
    createHomeClient({
      fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    }).getHomeData(),
    /資料格式不符/,
  );
});
