import { resolve } from 'node:path';
import { createRepository } from './repository.js';
import { createApp } from './app.js';
import { createDiscordNotifier } from './discord-notifier.js';

const repository = createRepository({
  filename: process.env.DATABASE_PATH || resolve('data/guildmanager.sqlite'),
});
const host = process.env.API_HOST || '127.0.0.1';
const port = Number(process.env.API_PORT || 3001);
const app = createApp(repository, { notifier: createDiscordNotifier() });
const server = app.listen(port, host, () => {
  console.log(`GuildManager API: http://${host}:${port}`);
});

function shutdown() {
  server.close(() => {
    repository.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
