import test from 'node:test';
import assert from 'node:assert/strict';
import { memberEditActions, memberEditFields, formatEditValue, formatEditTime } from '../src/domain/member-edit-history.js';
import { createMemberClient } from '../src/api/members.js';

test('all contracted actions and fields have Chinese labels', () => {
  for (const action of ['create', 'update', 'remove', 'restore', 'maintenance', 'import', 'history_edit', 'permanent_delete']) assert.match(memberEditActions[action], /[\u4e00-\u9fff]/);
  for (const field of ['name', 'uid', 'primaryProfession', 'secondaryProfession', 'isInGuild', 'isInClub', 'joinedAt', 'previousNames', 'maintenance']) assert.ok(memberEditFields[field]);
});
test('history renders booleans, empty values and profession names', () => {
  assert.equal(formatEditValue('isInGuild', false), '否');
  assert.equal(formatEditValue('isInClub', true), '是');
  assert.equal(formatEditValue('secondaryProfession', null), '—');
  assert.equal(formatEditValue('primaryProfession', 1, [{ job_id: 1, name: '神相' }]), '神相');
  assert.equal(formatEditValue('primaryProfession', { name: '神相' }), '神相');
  assert.equal(formatEditValue('primaryProfession', '神相'), '神相');
  assert.equal(formatEditValue('previousNames', []), '—');
  assert.equal(formatEditValue('previousNames', ['舊名一', '舊名二']), '舊名一、舊名二');
  assert.equal(formatEditTime('bad'), '—');
  assert.equal(formatEditTime(undefined), '—');
  assert.equal(formatEditTime(''), '—');
  assert.match(formatEditTime('2026-01-01T00:00:00Z'), /08:00:00/);
});
test('history client encodes UID and optional pagination cursor', async () => {
  const paths = [];
  const client = createMemberClient({ fetchImpl: async (path, options) => {
    paths.push(path); assert.equal(options.method, 'GET');
    return { ok: true, json: async () => ({ items: [], nextCursor: 'next' }) };
  } });
  assert.equal((await client.getMemberEditHistory('a/b')).nextCursor, 'next');
  await client.getMemberEditHistory('a/b', 'x+y/=');
  assert.deepEqual(paths, ['/api/members/a%2Fb/edit-history', '/api/members/a%2Fb/edit-history?cursor=x%2By%2F%3D']);
});
