import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = JSON.parse(readFileSync(resolve(root, 'gas/upload-target.json'), 'utf8'));
if (!/^[A-Za-z0-9_-]{20,150}$/.test(target.scriptId || '')) throw new Error('指令碼 ID 格式不正確');
const credentialPath = resolve(root, 'data/clasp-auth.json');
const configPath = resolve(root, '.clasp.json');
const outputPath = resolve(root, 'build/gas');
const claspPath = resolve(root, 'node_modules/@google/clasp/build/src/index.js');
const expectedFiles = ['Backend.gs', 'Code.gs', 'Index.html', 'appsscript.json'];
const command = process.argv[2];
if (!['login', 'status', 'push', 'auth-status'].includes(command)) {
  throw new Error('請使用 npm run gas:login、gas:status、gas:push 或 gas:auth');
}

function run(args, project = configPath, capture = false) {
  const result = spawnSync(
    process.execPath,
    [claspPath, '-A', credentialPath, '-P', project, ...args],
    {
      cwd: root,
      stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
      encoding: 'utf8',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`clasp 操作失敗（${result.status}），請查看上方錯誤訊息`);
  }
  return result.stdout;
}

function writeConfig(path, rootDir) {
  writeFileSync(
    path,
    JSON.stringify({ scriptId: target.scriptId, rootDir, scriptExtensions: ['gs'] }, null, 2) +
      '\n',
  );
}
function validatePackage() {
  const files = readdirSync(outputPath).sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles))
    throw new Error('GAS 套件必須恰好包含四個編譯檔，請重新編譯');
  const html = readFileSync(resolve(outputPath, 'Index.html'), 'utf8');
  if (
    /<script\b[^>]*\bsrc\s*=|<link\b[^>]*\brel=["'](?:stylesheet|modulepreload)["']/i.test(html)
  ) {
    throw new Error('GAS HTML 仍包含外部 JS／CSS');
  }
}
function pullSnapshot(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const project = resolve(directory, '.clasp.json');
  writeConfig(project, '.');
  run(['pull'], project);
}
function canonicalManifest(text) {
  const sort = (value) =>
    Array.isArray(value)
      ? value.map(sort)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, sort(value[key])]),
          )
        : value;
  return JSON.stringify(sort(JSON.parse(text)));
}

// This public ID is separate from OAuth credentials; never reuse an unrelated project config.
if (existsSync(configPath)) {
  const previous = JSON.parse(readFileSync(configPath, 'utf8'));
  if (previous.scriptId !== target.scriptId)
    throw new Error('現有 .clasp.json 指向其他專案，請先確認上傳目標');
}
writeConfig(configPath, 'build/gas');
mkdirSync(dirname(credentialPath), { recursive: true, mode: 0o700 });

if (command === 'login') {
  run(['login']);
  if (existsSync(credentialPath)) chmodSync(credentialPath, 0o600);
} else if (command === 'auth-status') {
  run(['show-authorized-user']);
} else if (command === 'status') {
  validatePackage();
  run(['show-file-status']);
} else {
  if (!existsSync(credentialPath)) throw new Error('請先執行 npm run gas:login 完成 Google 登入');
  const build = spawnSync('npm', ['run', 'build:gas'], { cwd: root, stdio: 'inherit' });
  if (build.error || build.status !== 0) throw new Error('GAS 編譯失敗，未上傳');
  validatePackage();
  const status = JSON.parse(run(['--json', 'show-file-status'], configPath, true));
  const files = status.filesToPush.map((path) => basename(path)).sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles))
    throw new Error('clasp 上傳清單與四檔套件不符，未上傳');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = resolve(root, 'data/gas-backups', stamp);
  console.log(`上傳目標：${target.scriptId}`);
  pullSnapshot(resolve(backup, 'before'));
  run(['push', '--force']);
  const after = resolve(backup, 'after');
  pullSnapshot(after);
  const remoteFiles = readdirSync(after)
    .filter((file) => file !== '.clasp.json')
    .sort();
  if (JSON.stringify(remoteFiles) !== JSON.stringify(expectedFiles))
    throw new Error('程式已上傳，但讀回的檔案清單不符，請檢查遠端專案');
  for (const file of expectedFiles) {
    const local = readFileSync(resolve(outputPath, file), 'utf8');
    const remote = readFileSync(resolve(after, file), 'utf8');
    const normalize =
      file === 'appsscript.json' ? canonicalManifest : (text) => text.replace(/\r\n/g, '\n').trim();
    if (normalize(local) !== normalize(remote))
      throw new Error(`${file} 已上傳但讀回內容不同，請檢查遠端專案`);
  }
  console.log('四個檔案已上傳並讀回比對成功。此次只同步程式，未初始化試算表或發布 Web App。');
  console.log(`遠端前後備份：${backup}`);
}
