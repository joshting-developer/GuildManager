import express from 'express';

export function createApp(repository) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/api/health', (_request, response) => {
    repository.readHome();
    response.json({ status: 'ok' });
  });
  app.get('/api/home', (_request, response) => {
    response.set('Cache-Control', 'no-store').json(repository.readHome());
  });
  app.use('/api', (_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: '找不到這個資料介面' } });
  });
  app.use((error, _request, response, _next) => {
    console.error('API read failed:', error.message);
    response
      .status(500)
      .json({ error: { code: 'READ_FAILED', message: '目前無法讀取資料，請稍後再試' } });
  });
  return app;
}
