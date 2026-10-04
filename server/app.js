import express from 'express';
import { installAuth } from './auth.js';
import { AuthError } from './auth-repository.js';
import { EventError } from './event-repository.js';
import { LineupError } from './lineup-repository.js';
import { DutyError } from './duty-repository.js';
import { MemberError } from './member-validation.js';
import { ParticipationError } from './participation-repository.js';
import { BattleRecordError } from '../src/domain/battle-records.js';

export function createApp(repository, { authNow } = {}) {
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
  app.use('/api/lineups', express.json({ limit: '64kb' }));
  app.use('/api/battle-records', express.json({ limit: '10mb' }));
  app.use(express.json({ limit: '16kb' }));
  installAuth(app, repository, { now: authNow });
  app.get('/api/admin/accounts', (request, response) => {
    response.json(repository.getAccountSettings(request.auth.user.id));
  });
  app.post('/api/admin/password', async (request, response) => {
    response.json({
      admin: await repository.changeAdminPassword(
        request.auth.user.id,
        request.body,
        request.sessionToken,
      ),
    });
  });
  app.post('/api/admin/managers', async (request, response) => {
    response
      .status(201)
      .json({ manager: await repository.createManager(request.auth.user.id, request.body) });
  });
  app.patch('/api/admin/managers/:id', async (request, response) => {
    response.json({
      manager: await repository.updateManager(
        request.auth.user.id,
        request.params.id,
        request.body,
      ),
    });
  });
  app.post('/api/admin/members', async (request, response) => {
    response
      .status(201)
      .json({ member: await repository.createMemberAccount(request.auth.user.id, request.body) });
  });
  app.patch('/api/admin/members/:id', async (request, response) => {
    response.json({
      member: await repository.updateMemberAccount(
        request.auth.user.id,
        request.params.id,
        request.body,
      ),
    });
  });
  app.get('/api/calendar/members', (_request, response) => {
    response.json(repository.listParticipationMembers());
  });
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
    const result = ['guild_war', 'dragon_tiger'].includes(request.body?.type)
      ? { events: repository.createEventBatch(request.body) }
      : { event: repository.createEvent(request.body) };
    response.status(201).json(result);
  });
  app.patch('/api/events/:id', (request, response) => {
    response.json({ event: repository.updateEvent(request.params.id, request.body) });
  });
  app.delete('/api/events/:id', (request, response) => {
    response.json(repository.deleteEvent(request.params.id, request.body?.revision));
  });
  app.get('/api/professions', (_request, response) => {
    response.set('Cache-Control', 'no-store').json(repository.listProfessions());
  });
  app.get('/api/battle-records', (request, response) => {
    response.json(
      repository.listBattleRecords({
        page: request.query.page === undefined ? 1 : Number(request.query.page),
        eventId: request.query.eventId,
      }),
    );
  });
  app.post('/api/battle-records', (request, response) => {
    response.status(201).json(repository.saveBattleRecords(request.body));
  });
  app.get('/api/battle-records/:id', (request, response) => {
    response.json({ record: repository.getBattleRecord(request.params.id) });
  });
  app.get('/api/battle-records/:id/attachments/:kind', (request, response) => {
    const attachment = repository.getBattleAttachment(request.params.id, request.params.kind);
    response.set('X-Content-Type-Options', 'nosniff');
    response.set('Content-Type', attachment.mimeType);
    response.set(
      'Content-Disposition',
      `attachment; filename="download.${request.params.kind === 'csv' ? 'csv' : attachment.mimeType.split('/')[1]}"; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
    );
    response.send(attachment.bytes);
  });
  app.get('/api/events/:id/participation', (request, response) => {
    response
      .set('Cache-Control', 'no-store')
      .json(repository.getEventParticipation(request.params.id));
  });
  app.get('/api/events/:id/participation-members', (request, response) => {
    response.json(repository.listEventParticipationMembers(request.params.id));
  });
  app.patch('/api/events/:id/participation', (request, response) => {
    response.json({ response: repository.saveMemberResponse(request.params.id, request.body) });
  });
  app.post('/api/events/:id/participation', (request, response) => {
    response.json(repository.submitParticipation(request.params.id, request.body));
  });
  app.post('/api/events/:id/registrations', (request, response) => {
    response
      .status(201)
      .json({ registration: repository.addGuestRegistration(request.params.id, request.body) });
  });
  app.delete('/api/events/:id/registrations/:registrationId', (request, response) => {
    response.json({
      registration: repository.cancelGuestRegistration(
        request.params.id,
        request.params.registrationId,
        request.body?.revision,
      ),
    });
  });
  app.get('/api/lineups', (_request, response) => {
    response.set('Cache-Control', 'no-store').json(repository.getLineupIndex());
  });
  app.get('/api/duties', (_request, response) => {
    response.set('Cache-Control', 'no-store').json(repository.listDuties());
  });
  app.post('/api/duties', (request, response) => {
    response.status(201).json({ duty: repository.addDuty(request.body) });
  });
  app.patch('/api/duties/:id', (request, response) => {
    response.json({ duty: repository.updateDuty(request.params.id, request.body) });
  });
  app.get('/api/lineups/events/:id', (request, response) => {
    response.set('Cache-Control', 'no-store').json(repository.getLineupHistory(request.params.id));
  });
  app.post('/api/lineups/confirm', (request, response) => {
    response.status(201).json({ version: repository.confirmLineup(request.body) });
  });
  app.post('/api/lineups/templates', (request, response) => {
    response.status(201).json({ template: repository.createLineupTemplate(request.body) });
  });
  app.get('/api/lineups/templates/:id/apply/:eventId', (request, response) => {
    response
      .set('Cache-Control', 'no-store')
      .json(repository.applyLineupTemplate(request.params.id, request.params.eventId));
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
    if (
      error instanceof AuthError ||
      error instanceof MemberError ||
      error instanceof EventError ||
      error instanceof LineupError ||
      error instanceof DutyError ||
      error instanceof ParticipationError ||
      error instanceof BattleRecordError
    ) {
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
