// Run after npm run build, with PLAYWRIGHT_MODULE and an isolated
// GUILD_MYSQL_REPOSITORY_TEST_CONFIG. Screenshots stay outside Git.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { createTestRepository, reopenTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createHttpConfig } from '../../server/http-config.js';
import { taipeiToday } from '../../src/domain/battle-events.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.BROWSER_ARTIFACT_DIR || '.local/video-name-redo';
mkdirSync(output, { recursive: true });
const repository = await createTestRepository();
let server, browser, currentPage;
try {
  await repository.addMember({ uid: 'secondary', name: '副職業成員', primaryProfessionId: 1, secondaryProfessionId: 2, isInGuild: true, isInClub: true });
  const date = taipeiToday();

  const config = { ...createHttpConfig(), staticDir: path.resolve('dist') };
  server = createApp(repository, { httpConfig: config }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  config.allowedOrigins.push(origin);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [1440, 768, 390]) for (const theme of ['light', 'dark']) {
    const event = await repository.createEvent({ title: `影片名稱驗收-${width}-${theme}`, type: 'scrimmage', dates: [date], requestId: crypto.randomUUID() });
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    currentPage = page;
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(value => localStorage.setItem('guild-theme', value), theme);
    await page.goto(origin, { waitUntil: 'networkidle' });
    const [y, m, d] = date.split('-').map(Number);
    await page.getByRole('button', { name: `${y} 年 ${m} 月 ${d} 日，查看安排及報名／請假`, exact: true }).click();
    await page.getByRole('button', { name: new RegExp(`影片名稱驗收-${width}-${theme}.*報名`) }).click();
    const picker = page.locator('.name-source-picker:visible');
    await picker.getByRole('tab').first().waitFor();
    assert.deepEqual(await picker.getByRole('tab').allTextContents(), ['幫會成員名單', '龍虎戰成員名單']);
    const participation = page.locator('.participation-form');
    const select = async (field, option) => {
      await field.locator('.v-field').click();
      await page.getByRole('option', { name: option, exact: true }).click();
    };
    for (const status of ['報名', '請假']) {
      await select(participation.locator('.name-source-profession'), '龍吟');
      await participation.getByLabel('幫會成員', { exact: true }).click();
      await page.getByRole('option', { name: /副職業成員/ }).click();
      if (status === '請假') await select(participation.locator('.v-select').filter({ has: page.getByLabel('狀態', { exact: true }) }), status);
      await participation.getByRole('button', { name: `送出${status}`, exact: true }).click();
      await page.getByText(`${status}成功`, { exact: true }).waitFor();
      const saved = await repository.getEventParticipation(event.id);
      assert.equal(saved.responses.find(row => row.uid === 'secondary').status, status === '報名' ? 'registered' : 'leave');
    }
    await page.getByRole('tab', { name: '影片上傳', exact: true }).click();
    const form = page.locator('.video-upload-form');
    assert.deepEqual(await form.getByRole('tab').allTextContents(), ['幫會成員名單', '龍虎戰成員名單', '直接輸入名稱']);
    await form.getByRole('button', { name: '送出', exact: true }).click();
    const profession = form.locator('.name-source-profession');
    await profession.getByText('請選擇職業', { exact: true }).waitFor();
    assert.ok((await profession.boundingBox()).y < (await form.getByLabel('幫會成員', { exact: true }).boundingBox()).y);
    await profession.locator('.v-field').click();
    await page.getByRole('option', { name: '龍吟', exact: true }).click();
    await form.getByLabel('幫會成員', { exact: true }).click();
    await page.getByRole('option', { name: /副職業成員/ }).click();
    await page.getByRole('option', { name: /副職業成員/ }).waitFor({ state: 'hidden' });
    await page.keyboard.press('Tab');
    assert.ok((await profession.innerText()).includes('龍吟'));
    await page.screenshot({ path: `${output}/names-${width}-${theme}.png` });
    const submitVideo = async (name, suffix, fail = false) => {
      const url = `https://example.com/video/${width}/${theme}/${suffix}`;
      await form.getByLabel('第一場網址（選填）', { exact: true }).fill(url);
      await select(form.locator('.v-select').filter({ has: page.getByLabel('團別', { exact: true }) }), '進攻團');
      await form.getByLabel('備註（選填）', { exact: true }).fill(suffix);
      const endpoint = `**/api/events/${event.id}/videos`;
      const before = (await repository.listEventVideos(event.id)).total;
      if (fail) {
        await page.route(endpoint, route => route.request().method() === 'POST'
          ? route.fulfill({ status: 503, json: { error: { code: 'DATABASE_ERROR', message: '測試暫時無法儲存' } } })
          : route.continue());
        await form.getByRole('button', { name: '送出', exact: true }).click();
        await form.getByText('測試暫時無法儲存', { exact: true }).waitFor();
        assert.equal(await form.getByLabel('第一場網址（選填）', { exact: true }).inputValue(), url);
        assert.equal(await form.getByLabel('備註（選填）', { exact: true }).inputValue(), suffix);
        assert.ok((await profession.innerText()).includes('龍吟'));
        assert.equal(await form.getByLabel('角色名稱', { exact: true }).inputValue(), name);
        assert.equal((await repository.listEventVideos(event.id)).total, before);
        await page.unroute(endpoint);
      }
      await form.getByRole('button', { name: '送出', exact: true }).click();
      await form.getByText('影片連結上傳成功', { exact: true }).waitFor();
      const saved = (await reopenTestRepository(repository).listEventVideos(event.id)).videos.find(video => video.firstUrl === url);
      assert.ok(saved, 'video survives repository recreation');
      assert.equal(saved.name, name);
      assert.equal(saved.professionId, 2);
      assert.equal(saved.groupName, '進攻一');
      assert.equal(saved.note, suffix);
      assert.equal(await form.getByLabel('第一場網址（選填）', { exact: true }).inputValue(), '');
      assert.equal(await form.getByLabel('備註（選填）', { exact: true }).inputValue(), '');
      assert.ok(!(await profession.innerText()).includes('龍吟'));
      const nameField = form.getByLabel(suffix === 'manual' ? '角色名稱' : suffix === 'club' ? '龍虎戰成員' : '幫會成員', { exact: true });
      assert.equal(await nameField.inputValue(), '');
    };
    await submitVideo('副職業成員', 'guild');
    await form.getByRole('tab', { name: '龍虎戰成員名單', exact: true }).click();
    await select(profession, '龍吟');
    await form.getByLabel('龍虎戰成員', { exact: true }).click();
    await page.getByRole('option', { name: /副職業成員/ }).click();
    await submitVideo('副職業成員', 'club');
    await form.getByRole('tab', { name: '直接輸入名稱', exact: true }).click();
    await form.getByLabel('角色名稱', { exact: true }).fill('手動驗收');
    await form.getByRole('button', { name: '送出', exact: true }).click();
    await profession.getByText('請選擇職業', { exact: true }).waitFor();
    await select(profession, '龍吟');
    await submitVideo('手動驗收', 'manual', true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${width} ${theme}`);
  }
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: `${output}/failure.png` });
    console.error(await currentPage.locator('.video-upload-form').innerText());
  }
  throw error;
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await repository.close();
}
