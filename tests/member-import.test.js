import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { parseMemberImport } from '../server/member-import.js';

function withRepo(callback) {
  const repo = createRepository({ filename: ':memory:' });
  try {
    callback(repo);
  } finally {
    repo.close();
  }
}
function importText(repo, text) {
  const preview = repo.previewMemberImport({ text });
  assert.deepEqual(preview.issues, []);
  return repo.importMembers({ text, fingerprint: preview.fingerprint });
}
test('imports whitespace text with names and long UID without precision loss', () =>
  withRepo((repo) => {
    const text =
      '\uFEFFUID Name 主職業 副職業\r\n00012345678901234567890 第一位 碎夢 素問\r\n002 第二位 神相 -';
    const preview = repo.previewMemberImport({ text });
    assert.equal(repo.listMembers().members.length, 0);
    assert.equal(preview.rows[0].primaryProfessionId, 3);
    const result = importText(repo, text);
    assert.deepEqual(result.summary, { added: 2, restored: 0, skipped: 0 });
    assert.equal(result.members[0].uid, '00012345678901234567890');
    assert.equal(result.members[1].secondaryProfessionId, null);
  }));
test('CSV handles quoted commas/escaped quotes; TSV preserves spaces and empty last column', () =>
  withRepo((repo) => {
    const csv = 'UID,Name,Job1,Job2\n001,"Name, ""Quoted""",龍吟,\n';
    assert.equal(importText(repo, csv).members[0].name, 'Name, "Quoted"');
    const tsv = 'UID\t名稱\t主職業\t副職業\n002\tName With Space\t潮光\t\n';
    const result = importText(repo, tsv);
    assert.equal(result.members[0].name, 'Name With Space');
    assert.equal(result.members[0].secondaryProfessionId, null);
  }));
test('existing active UIDs are skipped without renaming or changing jobs; repeat preview is harmless', () =>
  withRepo((repo) => {
    importText(repo, '001 原名稱 碎夢 -');
    const result = importText(repo, '001 不應改名 素問 龍吟\n002 新成員 鐵衣 -');
    assert.deepEqual(result.summary, { added: 1, restored: 0, skipped: 1 });
    const existing = repo.listMembers().members.find((member) => member.uid === '001');
    assert.equal(existing.name, '原名稱');
    assert.equal(existing.primaryProfessionId, 3);
    assert.deepEqual(existing.previousNames, []);
    const repeated = importText(repo, '001 不應改名 素問 龍吟\n002 新成員 鐵衣 -');
    assert.equal(repeated.summary.added, 0);
    assert.equal(repeated.summary.skipped, 2);
  }));
test('unknown jobs, malformed rows/header and duplicate imported UIDs block the entire batch', () =>
  withRepo((repo) => {
    const text =
      'UID Name 主職業 副職業\n001 合法 碎夢 -\n002 錯誤 不存在 -\n001 重複 素問 -\n003 少欄 碎夢';
    const preview = repo.previewMemberImport({ text });
    assert.deepEqual(
      preview.issues.map((issue) => issue.line),
      [3, 4, 5],
    );
    assert.equal(preview.fingerprint, null);
    assert.throws(
      () => repo.importMembers({ text, fingerprint: 'invalid' }),
      (error) => error.code === 'IMPORT_INVALID' && error.rows.length === 3,
    );
    assert.equal(repo.listMembers().members.length, 0);
    assert.ok(
      repo
        .previewMemberImport({ text: 'UID Name 副職業 主職業\n001 成員 碎夢 -' })
        .issues[0].message.includes('表頭'),
    );
    assert.ok(
      repo
        .previewMemberImport({ text: '001 成員 碎夢 不存在' })
        .issues[0].message.includes('副職業'),
    );
  }));
test('stale previews and modified input cannot write; concurrent UID addition requires re-preview', () =>
  withRepo((repo) => {
    const text = '001 匯入成員 碎夢 -';
    const preview = repo.previewMemberImport({ text });
    assert.throws(
      () => repo.importMembers({ text: '002 修改輸入 素問 -', fingerprint: preview.fingerprint }),
      (error) => error.code === 'STALE_IMPORT',
    );
    repo.addMember({ uid: '001', name: '另一人新增', primaryProfessionId: 1 });
    assert.throws(
      () => repo.importMembers({ text, fingerprint: preview.fingerprint }),
      (error) => error.code === 'STALE_IMPORT',
    );
    assert.equal(repo.listMembers().members[0].name, '另一人新增');
  }));
test('import skips an external UID and preserves its name, flags and history', () =>
  withRepo((repo) => {
    let old = importText(repo, '001 原名稱 碎夢 -').members[0];
    old = repo.updateMember(old.uid, {
      name: '編外名稱',
      primaryProfessionId: 3,
      revision: old.revision,
    });
    const external = repo.removeMember(old.uid, old.revision).member;
    const result = importText(repo, '001 不應覆寫 素問 -');
    assert.deepEqual(result.summary, { added: 0, restored: 0, skipped: 1 });
    assert.deepEqual(result.members, []);
    assert.deepEqual(repo.listMembers().members[0], external);
  }));
test('a later write failure rolls back every member in a batch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guild-import-'));
  const filename = join(directory, 'test.sqlite');
  const repo = createRepository({ filename });
  try {
    const text = '001 第一位 碎夢 -\n002 第二位 素問 -';
    const preview = repo.previewMemberImport({ text });
    const db = new Database(filename);
    db.exec(
      "CREATE TRIGGER fail_second BEFORE INSERT ON members WHEN NEW.uid = '002' BEGIN SELECT RAISE(ABORT, 'test import failure'); END;",
    );
    db.close();
    assert.throws(
      () => repo.importMembers({ text, fingerprint: preview.fingerprint }),
      /test import failure/,
    );
    assert.deepEqual(repo.listMembers().members, []);
  } finally {
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('import bounds and broken quotes are reported before writing', () =>
  withRepo((repo) => {
    assert.throws(
      () => repo.previewMemberImport({ text: ' ' }),
      (error) => error.code === 'IMPORT_EMPTY',
    );
    assert.throws(
      () => repo.previewMemberImport({ text: '中'.repeat(100000) }),
      (error) => error.code === 'IMPORT_TOO_LARGE',
    );
    assert.throws(
      () =>
        repo.previewMemberImport({
          text: Array.from({ length: 501 }, (_, index) => `${index} 成員 碎夢 -`).join('\n'),
        }),
      (error) => error.code === 'IMPORT_TOO_MANY',
    );
    const jobs = repo.listProfessions().professions;
    assert.ok(parseMemberImport('001,"未結尾,碎夢,-', jobs).issues.length);
    assert.ok(parseMemberImport('001,"名字"extra,碎夢,-', jobs).issues.length);
    assert.ok(parseMemberImport('001,"含\n換行",碎夢,-', jobs).issues.length);
  }));
test('import APIs return preview/summary, accept payloads larger than a single-member request', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const fetch = await authenticatedFetch(server, repo);
  const base = `http://127.0.0.1:${server.address().port}/api/members/import`;
  const send = (path, body) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    const text = Array.from(
      { length: 300 },
      (_, index) => `${String(index).padStart(20, '0')} 這是成員名稱 碎夢 素問`,
    ).join('\n');
    let response = await send('/preview', { text });
    assert.equal(response.status, 200);
    const preview = await response.json();
    assert.equal(preview.rows.length, 300);
    response = await send('', { text, fingerprint: preview.fingerprint });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).summary.added, 300);
    response = await send('', { text, fingerprint: preview.fingerprint });
    assert.equal(response.status, 409);
    response = await send('', { text: '001 錯誤 錯職業 -', fingerprint: 'bad' });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.rows[0].line, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
});
