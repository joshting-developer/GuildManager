import { resolve } from 'node:path';
import { createRepository } from './repository.js';

// Read credentials through stdin, not command arguments or application logs.
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 4096) throw new Error('帳號設定內容過大');
}
const repository = createRepository({
  filename: process.env.DATABASE_PATH || resolve('data/guildmanager.sqlite'),
});
try {
  const account = await repository.createAccount(JSON.parse(input));
  console.log(`已建立本機登入帳號：${account.username}`);
} catch (error) {
  console.error(error instanceof SyntaxError ? '請提供有效的帳號設定 JSON' : error.message);
  process.exitCode = 1;
} finally {
  repository.close();
}
