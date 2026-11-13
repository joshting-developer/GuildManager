import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { createRepository } from './repository.js';
import { createApp } from './app.js';
import { createDiscordNotifier } from './discord-notifier.js';

const repository = createRepository({
  filename: process.env.DATABASE_PATH || resolve('data/guildmanager.sqlite'),
});
const host = process.env.API_HOST || '127.0.0.1';
const port = Number(process.env.API_PORT || 3001);
const app = createApp(repository, { notifier: createDiscordNotifier() });
// The production image serves the compiled SPA and API on the same port.
// Development still uses Vite's proxy (no dist directory required).
if (process.env.NODE_ENV === 'production') {
  const dist = resolve('dist');
  if (!existsSync(resolve(dist, 'index.html'))) throw new Error('Missing dist/index.html; run npm run build first');
  app.use(express.static(dist, { index: false }));
  app.get(/.*/, (_request, response) => response.sendFile(resolve(dist, 'index.html')));
}
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
