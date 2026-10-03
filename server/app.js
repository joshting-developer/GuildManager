import express from 'express';
import { EventError } from './event-repository.js';
import { MemberError } from './member-validation.js';

export function createApp(repository) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (request, response, next) => {
    if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) return next();
    const origin = request.get('Origin');
    const allowed = /^http:\/\/(?:localhost|127\.0\.0\.1):(?:5173|5174|4173)$/.test(origin || '');
    if (origin && !allowed) {
      return response
        .status(403)
        .json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: '不允許此來源修改本機資料' } });
    }
    if (!request.is('application/json')) {
      return response
        .status(415)
        .json({ error: { code: 'JSON_REQUIRED', message: '請使用 JSON 提交資料' } });
    }
    next();
  });
  app.use('/api/members/import', express.json({ limit: '512kb' }));
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', (_request, response) => {
    repository.readHome();
    response.json({ status: 'ok' });
  });
  app.get('/api/home', (_request, response) => {
    response.set('Cache-Control', 'no-store').json(repository.readHome());
  });
  app.get('/api/events', (_request, response) => {
    response.set('Cache-Control', 'no-store').json(repository.listEvents());
  });
  app.post('/api/events', (request, response) => {
    response.status(201).json({ event: repository.createEvent(request.body) });
  });
  app.get('/api/professions', (_request, response) => {
    response.set('Cache-Control', 'no-store').json(repository.listProfessions());
  });
  app.get('/api/members', (_request, response) => {
    response.set('Cache-Control', 'no-store').json(repository.listMembers());
  });
  app.post('/api/members/import/preview', (request, response) => {
    response.set('Cache-Control', 'no-store').json(repository.previewMemberImport(request.body));
  });
  app.post('/api/members/import', (request, response) => {
    response.json(repository.importMembers(request.body));
  });
  app.post('/api/members', (request, response) => {
    response.status(201).json({ member: repository.addMember(request.body) });
  });
  app.patch('/api/members/:uid', (request, response) => {
    response.json({ member: repository.updateMember(request.params.uid, request.body) });
  });
  app.delete('/api/members/:uid', (request, response) => {
    response.json(repository.removeMember(request.params.uid, request.body?.revision));
  });
  app.use('/api', (_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: '找不到這個資料介面' } });
  });
  app.use((error, _request, response, _next) => {
    if (error instanceof MemberError || error instanceof EventError) {
      return response.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          fields: error.fields,
          ...(error.rows ? { rows: error.rows } : {}),
        },
      });
    }
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
      return response
        .status(error.status)
        .json({ error: { code: 'INVALID_BODY', message: '提交資料格式不正確或內容過大' } });
    }
    console.error('API read failed:', error.message);
    response
      .status(500)
      .json({ error: { code: 'OPERATION_FAILED', message: '目前無法完成操作，請稍後再試' } });
  });
  return app;
}
