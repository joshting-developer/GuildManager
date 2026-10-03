import { readFile } from 'node:fs/promises';

// 僅在手動執行時寫入本機 API，啟動應用程式不會自動播種。
const API_URL = 'http://127.0.0.1:3001/api';
const PROFESSION_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
let cookie = '';
let csrf = '';

async function request(path, member) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { Cookie: cookie, 'X-CSRF-Token': csrf },
    ...(member
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf },
          body: JSON.stringify(member),
        }
      : {}),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `API 回應 ${response.status}`);
  if (path === '/auth/login') {
    cookie = response.headers.get('set-cookie').split(';')[0];
    csrf = data.csrfToken;
  }
  return data;
}

async function seed() {
  const credentials = JSON.parse(
    await readFile(process.env.LOGIN_CREDENTIALS_PATH || 'data/local-admin.json', 'utf8'),
  );
  await request('/auth/login', credentials);
  const { professions } = await request('/professions');
  if (!PROFESSION_IDS.every((id) => professions.some((job) => job.job_id === id))) {
    throw new Error('找不到九種既定職業，未新增示範資料');
  }
  const { members } = await request('/members');
  const existingUids = new Set(members.map((member) => member.uid));
  let added = 0;
  let skipped = 0;
  for (let index = 0; index < 100; index += 1) {
    const isInGuild = index < 80;
    const number = String(isInGuild ? index + 1 : index - 79).padStart(3, '0');
    const uid = `DEMO-${isInGuild ? 'GUILD' : 'CLUB'}-${number}`;
    if (existingUids.has(uid)) {
      skipped += 1;
      continue;
    }
    await request('/members', {
      uid,
      name: `示範資料・${isInGuild ? '幫會' : '俱樂部'}${number}`,
      primaryProfessionId: PROFESSION_IDS[index % PROFESSION_IDS.length],
      secondaryProfessionId: PROFESSION_IDS[(index + 4) % PROFESSION_IDS.length],
      isInGuild,
      isInClub: true,
    });
    added += 1;
  }
  console.log(`示範成員：新增 ${added} 位、跳過 ${skipped} 位。既有資料保持原樣。`);
}

seed()
  .catch((error) => {
    console.error(
      `示範成員建立中斷：${error.message}。請確認本機 API 已啟動後重試；已存在的 UID 會跳過。`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (cookie) {
      try {
        await request('/auth/logout', {});
      } catch {
        console.error('無法完成播種帳號登出, session 將於期限到達後失效');
      }
    }
  });
