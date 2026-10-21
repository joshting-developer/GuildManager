import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyLineup } from '../src/domain/lineups.js';
import { lineupImageData, lineupImageFilename, lineupJpeg } from '../src/domain/lineup-image.js';

function fixture(theme = 'light') {
  const teams = emptyLineup();
  Object.assign(teams[0].slots[0], { uid: 'private-id', profession: 'secondary', note: '拆塔\n第二行備註', dutyIds: ['duty'],
    secondRound: { uid: null, registrationId: 'guest-id', profession: 'primary' } });
  return lineupImageData({
    event: { type: 'scrimmage', title: '示範圖片／測試', dates: ['2026-11-26'] },
    teams, theme, status: '有未儲存修改', snapshots: false,
    members: [
      { uid: 'private-id', name: '示範成員', primaryProfessionId: 1, secondaryProfessionId: 2 },
      { registrationId: 'guest-id', name: '示範外援', primaryProfessionId: 1 },
    ],
    professions: [
      { job_id: 1, name: '素問', colorcode: '#ffb6c1' },
      { job_id: 2, name: '龍吟', colorcode: '#3cb371' },
    ],
    duties: [{ id: 'duty', name: '山盟', active: false }],
  });
}

async function render(data, { contextAvailable = true, blobAvailable = true } = {}) {
  const calls = [];
  let scale = 1;
  const context = {
    scale(x, y) { assert.equal(x, y); scale *= x; },
    measureText(value) {
      const size = Number(this.font.match(/([\d.]+)px/)[1]);
      return { width: [...value].reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? size : size * 0.55), 0) };
    },
    fillRect(x, y, width, height) { calls.push({ type: 'fill', x: x * scale, y: y * scale, width: width * scale, height: height * scale, color: this.fillStyle }); },
    strokeRect(x, y, width, height) { calls.push({ type: 'border', x: x * scale, y: y * scale, width: width * scale, height: height * scale }); },
    fillText(value, x, y) {
      calls.push({ type: 'text', value, x: x * scale, y: y * scale, font: this.font.replace(/([\d.]+)px/, (_, size) => `${Number(size) * scale}px`), align: this.textAlign, color: this.fillStyle, width: this.measureText(value).width * scale });
    },
  };
  const canvas = {
    getContext: () => contextAvailable ? context : null,
    toBlob(callback, type) { callback(blobAvailable ? new Blob(['isolated'], { type }) : null); },
  };
  const before = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = { fonts: { ready: Promise.resolve() }, createElement: () => canvas };
  try {
    const blob = await lineupJpeg(data);
    return { blob, canvas, calls };
  } finally {
    if (before) Object.defineProperty(globalThis, 'document', before);
    else delete globalThis.document;
  }
}

test('image data preserves all positions, both rounds, selected jobs, notes and status without identities', () => {
  const data = fixture('dark');
  assert.equal(data.theme, 'dark');
  assert.equal(data.groups.flatMap((g) => g.teams).length, 10);
  assert.equal(data.groups.flatMap((g) => g.teams.flatMap((t) => t.rows)).length, 60);
  const row = data.groups[0].teams[0].rows[0];
  assert.deepEqual(row.people.map((p) => [p.round, p.name, p.job]), [
    ['第一場', '示範成員', '龍吟'], ['第二場', '示範外援', '素問'],
  ]);
  assert.equal(row.description, '山盟（停用） · 拆塔\n第二行備註');
  for (const value of ['private-id', 'guest-id', '"uid"', '"registrationId"'])
    assert.ok(!JSON.stringify(data).includes(value));
  assert.equal(fixture('invalid').theme, 'light');
  assert.equal(lineupImageFilename(data), '2026-11-26_約戰 · 示範圖片／測試_戰場排表.jpg');
});

test('archived image data uses names, jobs and duties from snapshots without live roster lookups', () => {
  const teams = emptyLineup();
  Object.assign(teams[0].slots[0], { uid: 'old-id', profession: 'secondary', note: '原備註', dutyIds: ['gone'],
    member: { name: '當時姓名', secondaryProfession: { name: '當時職業', colorcode: '#ff0000' } },
    duties: [{ id: 'gone', name: '當時職責' }] });
  const data = lineupImageData({ event: { type: 'guild_war', title: '', dates: ['2026-11-26'] }, teams,
    members: [], professions: [], duties: [], snapshots: true, status: '封存', theme: 'dark' });
  const row = data.groups[0].teams[0].rows[0];
  assert.equal(row.people[0].name, '當時姓名');
  assert.equal(row.people[0].job, '當時職業');
  assert.equal(row.description, '當時職責 · 原備註');
  assert.equal(data.title, '幫戰');
});

test('JPG uses separate readable columns and theme while retaining all team headers and rows', async () => {
  const light = await render(fixture());
  const dark = await render(fixture('dark'));
  for (const { blob, canvas, calls } of [light, dark]) {
    assert.equal(blob.type, 'image/jpeg');
    assert.equal(canvas.width, 5400);
    assert.equal(canvas.height, 3771);
    const texts = calls.filter((c) => c.type === 'text');
    for (const label of ['職業', '姓名', '職責／備註']) assert.equal(texts.filter((c) => c.value === label).length, 0);
    for (const number of ['1', '2', '3', '4', '5', '6']) assert.equal(texts.filter((c) => c.value === number).length, 0);
    assert.equal(texts.filter((c) => c.value.includes('（副）')).length, 0);
    assert.equal(texts.filter((c) => c.value === '—' && c.align === 'center').length, 59, 'empty positions show a dash');
    assert.equal(texts.filter((c) => c.value === '尚未安排').length, 0);
    assert.ok(texts.some((c) => c.value === '第一場'));
    assert.ok(texts.some((c) => c.value === '第二場'));
    const person = texts.find((c) => c.value === '示範成員');
    const job = texts.find((c) => c.value === '龍吟');
    const size = (call) => Number(call.font.match(/([\d.]+)px/)[1]);
    assert.ok(Math.abs(size(person) - 70.2) < 1e-6);
    assert.match(person.font, /^500 /, 'names use a medium weight, not bold');
    assert.ok(Math.abs(size(job) - 75.6) < 1e-6);
    assert.match(job.font, /^500 /);
    // Name and job share a vertical centre even though their sizes differ.
    assert.ok(person.x > job.x && Math.abs(person.y + size(person) / 2 - job.y - size(job) / 2) < 1e-6);
    assert.ok(texts.every((c) => c.y >= 0 && c.y + Number(c.font.match(/([\d.]+)px/)[1]) <= canvas.height));
    assert.ok(texts.some((c) => c.value.includes('有未儲存修改')));
  }
  assert.equal(light.calls[0].color, '#eef2f7');
  const sepia = await render(fixture('sepia'));
  assert.equal(sepia.calls[0].color, '#f1e9d8', 'the 米黃 theme exports a matching sepia image');
  assert.equal(dark.calls[0].color, '#121b2a');
  assert.notEqual(light.calls.find((c) => c.value === '示範成員').color, dark.calls.find((c) => c.value === '示範成員').color);
});

test('long names shrink to one line, then wrap completely at the minimum size, growing the image without horizontal clipping', async () => {
  const data = fixture('dark');
  data.title = '很長的安排標題'.repeat(14);
  for (const group of data.groups) for (const team of group.teams) {
    team.name = '長隊名測試'.repeat(8);
    for (const row of team.rows) {
      row.people = [1, 2].map((round) => ({ round: `第${round}場`, name: '長姓名測試'.repeat(10), job: '職業名稱（副）', color: '#8b0000' }));
      row.description = '長職責與備註'.repeat(12) + '\n保留換行';
    }
  }
  const original = JSON.stringify(data);
  const { canvas, calls } = await render(data);
  assert.equal(JSON.stringify(data), original);
  assert.ok(canvas.height > (await render(fixture('dark'))).canvas.height);
  const texts = calls.filter((c) => c.type === 'text');
  const names = texts.filter((c) => /^500 /.test(c.font) && Math.abs(Number(c.font.match(/([\d.]+)px/)[1]) - 48.6) < 1e-6 && c.align === 'center' && !/[職業副（）]/.test(c.value)).map((c) => c.value).join('');
  assert.equal(names, '長姓名測試'.repeat(10 * 2 * 60));
  assert.equal(texts.filter((c) => c.value === '保留換行').length, 60);
  for (const call of texts) {
    const left = call.align === 'center' ? call.x - call.width / 2 : call.align === 'right' ? call.x - call.width : call.x;
    assert.ok(left >= 0 && left + call.width <= canvas.width, call.value);
    const size = Number(call.font.match(/([\d.]+)px/)[1]);
    assert.ok(call.y + size <= canvas.height);
    if ([48.6, 59.4].some((expected) => Math.abs(size - expected) < 1e-6)) {
      assert.ok(calls.some((cell) => cell.type === 'fill' && ['#1b2639', '#172133'].includes(cell.color)
        && left >= cell.x && left + call.width <= cell.x + cell.width
        && call.y >= cell.y && call.y + size <= cell.y + cell.height), call.value);
    }
  }
});

test('jobs read clearly: true-colour pills on light and sepia, contrast-adjusted coloured text on dark', async () => {
  const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  for (const theme of ['light', 'sepia', 'dark']) {
    const data = fixture(theme);
    for (const [index, color] of ['#ffb6c1', '#3cb371', '#add8e6', '#00bfff', '#f0e68c', '#9932cc', '#ff8c00', '#8b0000', '#4682b4'].entries()) {
      const person = data.groups[0].teams[0].rows[index % 6].people[0];
      person.job = ['素問', '龍吟', '碎夢', '潮光', '玄機', '九靈', '鐵衣', '血河', '神相'][index];
      person.color = color;
      const { calls } = await render(data);
      const at = calls.findIndex((c) => c.type === 'text' && c.value === person.job);
      const label = calls[at];
      if (theme === 'dark') {
        assert.ok(ratio(label.color, '#1b2639') >= 4.5, `${theme} ${person.job}`);
        continue;
      }
      // The pill keeps the profession's own colour; its text is black or white, whichever reads.
      const pill = calls[at - 1];
      assert.equal(pill.type, 'fill');
      assert.equal(pill.color, color);
      assert.ok(pill.x <= label.x - label.width / 2 && pill.x + pill.width >= label.x + label.width / 2);
      assert.ok(ratio(label.color, color) >= 4.5 || ratio(label.color, color) === Math.max(ratio('#ffffff', color), ratio('#16202e', color)), `${theme} ${person.job}`);
    }
  }
});

test('unavailable Canvas or failed JPG encoding reports errors without modifying the draft', async () => {
  const data = fixture();
  const before = JSON.stringify(data);
  await assert.rejects(render(data, { contextAvailable: false }), /Canvas/);
  await assert.rejects(render(data, { blobAvailable: false }), /JPG 產生失敗/);
  assert.equal(JSON.stringify(data), before);
});
