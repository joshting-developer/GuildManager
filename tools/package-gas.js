import { copyFileSync, readFileSync, readdirSync, renameSync } from 'node:fs';

const directory = 'build/gas';
const html = readFileSync(`${directory}/index.html`, 'utf8');
if (
  readdirSync(directory).length !== 1 ||
  /<script\b[^>]*\bsrc\s*=|<link\b[^>]*\brel=["'](?:stylesheet|modulepreload)["']/i.test(html)
) {
  throw new Error('GAS 編譯仍包含外部 JS／CSS 或多餘檔案');
}
renameSync(`${directory}/index.html`, `${directory}/Index.html`);
for (const filename of ['Code.gs', 'appsscript.json']) {
  copyFileSync(`gas/${filename}`, `${directory}/${filename}`);
}
console.log(
  `GAS package ready: ${directory}/Index.html (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`,
);
