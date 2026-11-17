import { createApp } from './app.js';
import { reportError } from './error-log.js';

export async function startApi({ repository, notifier = null, host = '127.0.0.1', port = 3001, shutdownTimeoutMs = 10000, log = console }) {
  let stopping = false;
  const app = createApp(repository, { notifier, log, isStopping: () => stopping });
  let server;
  try {
    server = app.listen(port, host);
    await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  } catch (error) {
    await repository.close();
    throw error;
  }
  let shutdownPromise;
  return {
    server,
    shutdown() {
      if (shutdownPromise) return shutdownPromise;
      stopping = true;
      shutdownPromise = (async () => {
        let timer;
        const drained = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
          .finally(() => repository.close())
          .finally(() => notifier?.drain?.())
          .then(() => 0, (error) => { reportError(log, 'shutdown_failed', error); return 1; });
        const deadline = new Promise((resolve) => {
          timer = setTimeout(() => {
            server.closeAllConnections();
            reportError(log, 'shutdown_timeout');
            resolve(1);
          }, shutdownTimeoutMs);
        });
        try {
          return await Promise.race([drained, deadline]);
        } finally {
          clearTimeout(timer);
        }
      })();
      return shutdownPromise;
    },
  };
}
