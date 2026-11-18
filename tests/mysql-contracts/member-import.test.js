import { test } from 'node:test';
import assert from 'node:assert/strict';

import { join } from 'node:path';

import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

import { parseMemberImport } from '../../server/member-import.js';

async function withRepo(callback) {
  const repo = (await createRepository());
  try {
    (await callback(repo));
  } finally {
    (await repo.close());
  }
}
async function importText(repo, text) {
  const preview = (await repo.previewMemberImport({ text }));
  assert.deepEqual(preview.issues, []);
  return (await repo.importMembers({ text, fingerprint: preview.fingerprint }));
}
test('imports whitespace text with names and long UID without precision loss', async () =>
  (await withRepo(async (repo) => {
    const text =
      '\uFEFFUID Name 主職業 副職業\r\n00012345678901234567890 第一位 碎夢 素問\r\n002 第二位 神相 -';
    const preview = (await repo.previewMemberImport({ text }));
    assert.equal((await repo.listMembers()).members.length, 0);
    assert.equal(preview.rows[0].primaryProfessionId, 3);
    const result = (await importText(repo, text));
    assert.deepEqual(result.summary, { added: 2, restored: 0, skipped: 0 });
    assert.equal(result.members[0].uid, '00012345678901234567890');
    assert.equal(result.members[1].secondaryProfessionId, null);
  })));
test('CSV handles quoted commas/escaped quotes; TSV preserves spaces and empty last column', async () =>
  (await withRepo(async (repo) => {
    const csv = 'UID,Name,Job1,Job2\n001,"Name, ""Quoted""",龍吟,\n';
    assert.equal((await importText(repo, csv)).members[0].name, 'Name, "Quoted"');
    const tsv = 'UID\t名稱\t主職業\t副職業\n002\tName With Space\t潮光\t\n';
    const result = (await importText(repo, tsv));
    assert.equal(result.members[0].name, 'Name With Space');
    assert.equal(result.members[0].secondaryProfessionId, null);
  })));
test('existing active UIDs are skipped without renaming or changing jobs; repeat preview is harmless', async () =>
  (await withRepo(async (repo) => {
    (await importText(repo, '001 原名稱 碎夢 -'));
    const result = (await importText(repo, '001 不應改名 素問 龍吟\n002 新成員 鐵衣 -'));
    assert.deepEqual(result.summary, { added: 1, restored: 0, skipped: 1 });
    const existing = (await repo.listMembers()).members.find((member) => member.uid === '001');
    assert.equal(existing.name, '原名稱');
    assert.equal(existing.primaryProfessionId, 3);
    assert.deepEqual(existing.previousNames, []);
    const repeated = (await importText(repo, '001 不應改名 素問 龍吟\n002 新成員 鐵衣 -'));
    assert.equal(repeated.summary.added, 0);
    assert.equal(repeated.summary.skipped, 2);
  })));
test('unknown jobs, malformed rows/header and duplicate imported UIDs block the entire batch', async () =>
  (await withRepo(async (repo) => {
    const text =
      'UID Name 主職業 副職業\n001 合法 碎夢 -\n002 錯誤 不存在 -\n001 重複 素問 -\n003 少欄 碎夢';
    const preview = (await repo.previewMemberImport({ text }));
    assert.deepEqual(
      preview.issues.map((issue) => issue.line),
      [3, 4, 5],
    );
    assert.equal(preview.fingerprint, null);
    (await assert.rejects(
      async () => (await repo.importMembers({ text, fingerprint: 'invalid' })),
      (error) => error.code === 'IMPORT_INVALID' && error.rows.length === 3,
    ));
    assert.equal((await repo.listMembers()).members.length, 0);
    assert.ok(
      (await repo
        .previewMemberImport({ text: 'UID Name 副職業 主職業\n001 成員 碎夢 -' }))
        .issues[0].message.includes('表頭'),
    );
    assert.ok(
      (await repo
        .previewMemberImport({ text: '001 成員 碎夢 不存在' }))
        .issues[0].message.includes('副職業'),
    );
  })));
test('stale previews and modified input cannot write; concurrent UID addition requires re-preview', async () =>
  (await withRepo(async (repo) => {
    const text = '001 匯入成員 碎夢 -';
    const preview = (await repo.previewMemberImport({ text }));
    (await assert.rejects(
      async () => (await repo.importMembers({ text: '002 修改輸入 素問 -', fingerprint: preview.fingerprint })),
      (error) => error.code === 'STALE_IMPORT',
    ));
    (await repo.addMember({ uid: '001', name: '另一人新增', primaryProfessionId: 1 }));
    (await assert.rejects(
      async () => (await repo.importMembers({ text, fingerprint: preview.fingerprint })),
      (error) => error.code === 'STALE_IMPORT',
    ));
    assert.equal((await repo.listMembers()).members[0].name, '另一人新增');
  })));
test('import skips an external UID and preserves its name, flags and history', async () =>
  (await withRepo(async (repo) => {
    let old = (await importText(repo, '001 原名稱 碎夢 -')).members[0];
    old = (await repo.updateMember(old.uid, {
      name: '編外名稱',
      primaryProfessionId: 3,
      revision: old.revision,
    }));
    const external = (await repo.removeMember(old.uid, old.revision)).member;
    const result = (await importText(repo, '001 不應覆寫 素問 -'));
    assert.deepEqual(result.summary, { added: 0, restored: 0, skipped: 1 });
    assert.deepEqual(result.members, []);
    assert.deepEqual((await repo.listMembers()).members[0], external);
  })));

test('import bounds and broken quotes are reported before writing', async () =>
  (await withRepo(async (repo) => {
    (await assert.rejects(
      async () => (await repo.previewMemberImport({ text: ' ' })),
      (error) => error.code === 'IMPORT_EMPTY',
    ));
    (await assert.rejects(
      async () => (await repo.previewMemberImport({ text: '中'.repeat(100000) })),
      (error) => error.code === 'IMPORT_TOO_LARGE',
    ));
    (await assert.rejects(
      async () =>
        (await repo.previewMemberImport({
          text: Array.from({ length: 501 }, (_, index) => `${index} 成員 碎夢 -`).join('\n'),
        })),
      (error) => error.code === 'IMPORT_TOO_MANY',
    ));
    const jobs = (await repo.listProfessions()).professions;
    assert.ok(parseMemberImport('001,"未結尾,碎夢,-', jobs).issues.length);
    assert.ok(parseMemberImport('001,"名字"extra,碎夢,-', jobs).issues.length);
    assert.ok(parseMemberImport('001,"含\n換行",碎夢,-', jobs).issues.length);
  })));

test('preview reads only imported UIDs in one query for 1, 100 and 500 rows and preserves fingerprints', async () => withRepo(async repo => {
  const { repositoryDatabase } = await import('../helpers/mysql-repository.js');
  const { createHash } = await import('node:crypto');
  await repo.addMember({ uid: 'import-0', name: '既有', primaryProfessionId: 3 });
  await repo.addMember({ uid: 'outside-import', name: '無關', primaryProfessionId: 3 });
  const db = repositoryDatabase(repo);
  const [rawState] = await db.query('SELECT revision, removed_at FROM members WHERE uid=?', ['import-0']);
  const state = { revision: Number(rawState.revision), removed_at: rawState.removed_at };
  const transaction = db.transaction.bind(db);let reads = [];
  db.transaction = (work, options) => transaction(connection => work({ ...connection, query: async (sql, params) => {
    const rows = await connection.query(sql, params);
    if (sql.includes('FROM members')) reads.push({ sql, params, rows: rows.length });
    return rows;
  } }), options);
  for (const count of [1, 100, 500]) {
    reads = [];
    const text = Array.from({ length: count }, (_, i) => `import-${i} 測試${i} 碎夢 -`).join('\n');
    const preview = await repo.previewMemberImport({ text });
    assert.equal(reads.length, 1);
    assert.match(reads[0].sql, /WHERE uid IN/);
    assert.equal(reads[0].params.length, count);
    assert.ok(!reads[0].params.includes('outside-import'));
    assert.equal(reads[0].rows, 1);
    assert.deepEqual(preview.summary, { added: count - 1, restored: 0, skipped: 1 });
    const states = Array.from({ length: count }, (_, i) => i === 0 ? state : null);
    const expected = createHash('sha256').update(JSON.stringify({ rows: preview.rows, states })).digest('hex');
    assert.equal(preview.fingerprint, expected);
  }
}));
