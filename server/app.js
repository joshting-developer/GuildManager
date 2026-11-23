import { ProfessionError } from '../src/domain/professions.js';
import { packPersonalBattles } from '../src/domain/personal-battle-transport.js';
import { FileStorageError } from './storage/r2.js';
import express from 'express';
import { join } from 'node:path';
import { createHttpConfig, assertStaticBuild } from './http-config.js';
import { DatabaseError } from './database/mysql.js';
import { reportError } from './error-log.js';
import { PlatformSettingsError } from '../src/domain/platform-settings.js';
import { visibleCalendarEvents } from '../src/domain/calendar-access.js';
import { installAuth } from './auth.js';
import { AuthError } from './mysql/auth-repository.js';
import { EventError } from '../src/domain/event-validation.js';
import { LineupError } from '../src/domain/lineup-validation.js';
import { DutyError, ParticipationError } from './errors.js';
import { MemberError } from './member-validation.js';
import { BattleRecordError } from '../src/domain/battle-records.js';
import { EventVideoError } from '../src/domain/event-videos.js';
import { LotteryError } from '../src/domain/lottery.js';
import { withDefaultLineupEvent } from '../src/domain/lineup-index.js';

export function createApp(repository, { authNow, notifier = null, log = console, isStopping = () => false, healthTimeoutMs = 2000, httpConfig = createHttpConfig() } = {}) {
  const app = express();
  app.set('trust proxy', httpConfig.trustProxy);
  if (httpConfig.staticDir) assertStaticBuild(httpConfig.staticDir);
  const fileAccess = (request, roles) => ({ assertAccess: async () => {
    const auth = await repository.getSession(request.sessionToken);
    if (!auth) throw new AuthError(401, 'AUTH_REQUIRED', '請先登入後再使用此功能');
    if (!roles.includes(auth.user.role)) throw new AuthError(403, 'MANAGEMENT_REQUIRED', '目前帳號無法操作這個檔案');
  } });
  // Notifications are collected per operation and only handed to the notifier after the
  // MySQL transaction committed; a failed operation discards them.
  async function notifying(name, ...args) {
    const { data, notifications } = await repository.invoke(name, args);
    if (notifier && notifications.length) {
      let footer;
      try {
        const { platform } = await repository.getPlatformSettings();
        footer = platform.name;
      } catch (error) {
        reportError(log, 'notification_footer_failed', error);
      }
      try {
        Promise.resolve(notifier.send(notifications, { footer }))
          .catch((error) => reportError(log, 'notification_schedule_failed', error));
      } catch (error) {
        reportError(log, 'notification_schedule_failed', error);
      }
    }
    return data;
  }
  app.disable('x-powered-by');
  app.use('/api', (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    if (isStopping()) return response.status(503).json({ error: { code: 'SERVICE_STOPPING', message: '服務正在關閉，請稍後再試' } });
    next();
  });
  app.get('/api/live', (_request, response) => response.json({ status: 'ok' }));
  app.get('/api/health', async (_request, response) => {
    let timer;
    try {
      await Promise.race([
        repository.probe(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new DatabaseError('DATABASE_UNAVAILABLE')), healthTimeoutMs); }),
      ]);
      response.json({ status: 'ok' });
    } catch (error) {
      reportError(log, 'health_failed', error);
      response.status(503).json({ status: 'error', code: 'DATABASE_UNAVAILABLE' });
    } finally {
      clearTimeout(timer);
    }
  });
  app.use('/api', (request, response, next) => {
    if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) return next();
    const origin = request.get('Origin');
    const allowed = httpConfig.allowedOrigins.includes(origin);
    if (origin !== undefined && !allowed) {
      return response
        .status(403)
        .json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: '不允許此來源修改資料' } });
    }
    if (!request.is('application/json')) {
      return response
        .status(415)
        .json({ error: { code: 'JSON_REQUIRED', message: '請使用 JSON 提交資料' } });
    }
    next();
  });
  app.use('/api/members/import', express.json({ limit: '512kb' }));
  app.use('/api/members/:uid/history', express.json({ limit: '128kb' }));
  app.use('/api/lineups', express.json({ limit: '64kb' }));
  app.use('/api/battle-records', express.json({ limit: '10mb' }));
  app.use('/api/admin/platform-settings', express.json({ limit: '360kb' }));
  app.use('/api/lottery', express.json({ limit: '128kb' }));
  app.use(express.json({ limit: '16kb' }));
  installAuth(app, repository, { now: authNow, secureCookies: httpConfig.secureCookies });
  const attendanceAccess = (request, roles) => ({ assertAccess: async () => {
    const session = await repository.getSession(request.sessionToken);
    if (!session || !roles.includes(session.user.role)) throw new AuthError(403, 'MANAGEMENT_REQUIRED', '請重新登入有權限的管理帳號');
    return session.user;
  } });
  app.get('/api/admin/leave-settings', async (_request, response) => response.json(await repository.getLeaveSettings()));
  app.patch('/api/admin/leave-settings', async (request, response) => response.json(await repository.saveLeaveSettings(request.body, attendanceAccess(request, ['admin']))));
  app.get('/api/attendance/calendar', async (request, response) => response.json(await repository.getLeaveCalendar(request.query.month)));
  app.get('/api/attendance/members/:uid/leaves', async (request, response) => response.json(await repository.getMemberLeaveHistory(request.params.uid, request.query)));
  app.get('/api/attendance/options', async (request, response) => response.json(await repository.getAttendanceOptions(request.query.month)));
  app.get('/api/attendance', async (request, response) => response.json(await repository.getAttendanceHistory(request.query)));
  app.patch('/api/attendance', async (request, response) => response.json(await repository.saveAttendance(request.body, attendanceAccess(request, ['admin','manager']))));
  app.get('/api/platform-settings', async (_request, response) => {
    response.json(await repository.getPlatformSettings());
  });
  app.patch('/api/admin/platform-settings', async (request, response) => {
    response.json(await repository.updatePlatformSettings(request.body, fileAccess(request, ['admin'])));
  });
  app.get('/api/admin/accounts', async (request, response) => {
    response.json(await repository.getAccountSettings(request.auth.user.id));
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
  app.patch('/api/admin/member-token', async (request, response) => {
    response.json({
      memberToken: await repository.setMemberToken(request.auth.user.id, request.body),
    });
  });
  app.get('/api/calendar/members', async (_request, response) => {
    response.json(await repository.listParticipationMembers());
  });
  app.get('/api/events', async (request, response) => {
    const result = await repository.listEvents(request.query);
    const events = visibleCalendarEvents(result.events, request.auth?.user);
    response.set('Cache-Control', 'no-store').json({ ...result, events });
  });
  app.post('/api/events', async (request, response) => {
    const result = ['guild_war', 'dragon_tiger'].includes(request.body?.type)
      ? { events: await repository.createEventBatch(request.body) }
      : { event: await repository.createEvent(request.body) };
    response.status(201).json(result);
  });
  app.get('/api/events/:id', async (request, response) => {
    response.json(await repository.getEvent(request.params.id));
  });
  app.patch('/api/events/:id', async (request, response) => {
    response.json({ event: await repository.updateEvent(request.params.id, request.body) });
  });
  app.delete('/api/events/:id', async (request, response) => {
    response.json(await repository.deleteEvent(request.params.id, request.body?.revision));
  });
  app.get('/api/professions', async (_request, response) => {
    response.set('Cache-Control', 'no-store').json(await repository.listProfessions());
  });
  app.post('/api/professions', async (request, response) => {
    response.status(201).json({ profession: await repository.addProfession(request.body) });
  });
  app.patch('/api/professions/:id', async (request, response) => {
    response.json({ profession: await repository.updateProfession(Number(request.params.id), request.body) });
  });
  app.get('/api/battle-records', async (request, response) => {
    response.json(
      await repository.listBattleRecords({
        page: request.query.page === undefined ? 1 : Number(request.query.page),
        eventId: request.query.eventId,
      }),
    );
  });
  app.get('/api/admin/battle-sync/preview', async (_request, response) => {
    response.set('Cache-Control', 'no-store').json(await repository.previewBattleMemberSync());
  });
  app.post('/api/admin/battle-sync', async (request, response) => {
    response.json(await repository.syncBattleMembers(request.body));
  });
  app.post('/api/battle-records', async (request, response) => {
    response.status(201).json(await repository.saveBattleRecords(request.body, fileAccess(request, ['admin', 'manager'])));
  });
  app.get('/api/battle-records/:id/metadata', async (request, response) => {
    response.set('Cache-Control', 'no-store').json({ record: await repository.getBattleMetadata(request.params.id) });
  });
  app.get('/api/battle-upload/roster', async (_request, response) => {
    response.set('Cache-Control', 'no-store').json(await repository.getBattleUploadRoster());
  });
  app.get('/api/battle-records/:id', async (request, response) => {
    response.json({ record: await repository.getBattleRecord(request.params.id, {
      includeTeamContext: request.query.includeTeamContext === undefined || request.query.includeTeamContext === 'false'
        ? false : request.query.includeTeamContext === 'true' ? true : request.query.includeTeamContext,
    }) });
  });
  app.get('/api/battle-records/:id/team-analysis', async (request, response) => {
    response.json(await repository.getBattleTeamAnalysis(request.params.id));
  });
  app.patch('/api/battle-records/:id', async (request, response) => {
    response.json(await repository.updateBattleRecord(request.params.id, request.body));
  });
  app.delete('/api/battle-records/:id', async (request, response) => {
    response.json(await repository.deleteBattleRecord(request.params.id, request.body?.revision));
  });
  app.get('/api/battle-records/:id/attachments/:kind', async (request, response) => {
    const attachment = await repository.getBattleAttachment(request.params.id, request.params.kind, fileAccess(request, ['admin', 'manager', 'member']));
    response.set('X-Content-Type-Options', 'nosniff');
    response.set('Content-Type', attachment.mimeType);
    response.set(
      'Content-Disposition',
      `attachment; filename="download.${request.params.kind === 'csv' ? 'csv' : attachment.mimeType.split('/')[1]}"; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
    );
    response.send(attachment.bytes);
  });
  app.get('/api/events/:id/participation', async (request, response) => {
    response
      .set('Cache-Control', 'no-store')
      .json(await repository.getEventParticipation(request.params.id));
  });
  app.get('/api/events/:id/participation-form', async (request, response) => {
    response.json(await repository.getEventParticipationForm(request.params.id));
  });
  app.get('/api/events/:id/video-form', async (request, response) => {
    response.json(await repository.getEventVideoForm(request.params.id));
  });
  app.get('/api/events/:id/attendance', async (request, response) => {
    response.json(await repository.getEventAttendance(request.params.id));
  });
  app.patch('/api/events/:id/attendance', async (request, response) => {
    response.json(await notifying('cancelEventLeave', request.params.id, request.body));
  });
  app.get('/api/videos/browser', async (request, response) => {
    response.json(await repository.getVideoBrowser(request.query.eventId));
  });
  app.get('/api/events/:id/videos', async (request, response) => {
    response.json(await repository.listEventVideos(request.params.id));
  });
  app.post('/api/events/:id/videos', async (request, response) => {
    response.status(201).json(await repository.submitEventVideo(request.params.id, request.body));
  });
  app.patch('/api/events/:id/videos/:videoId/profession', async (request, response) => {
    response.json(await repository.updateEventVideoProfession(request.params.id, request.params.videoId, request.body));
  });
  app.patch('/api/events/:id/videos/:videoId/event', async (request, response) => {
    response.json(await repository.moveEventVideo(request.params.id, request.params.videoId, request.body));
  });
  app.delete('/api/events/:id/videos/:videoId', async (request, response) => {
    response.json(await repository.deleteEventVideo(request.params.id, request.params.videoId, request.body));
  });
  app.get('/api/events/:id/participation-members', async (request, response) => {
    response.json(await repository.listEventParticipationMembers(request.params.id));
  });
  app.patch('/api/events/:id/participation', async (request, response) => {
    response.json({
      response: await notifying('saveMemberResponse', request.params.id, request.body),
    });
  });
  app.post('/api/events/:id/participation', async (request, response) => {
    response.json(await notifying('submitParticipation', request.params.id, request.body));
  });
  app.post('/api/events/:id/registrations', async (request, response) => {
    response
      .status(201)
      .json({ registration: await repository.addGuestRegistration(request.params.id, request.body) });
  });
  // Management-only (under /api/lineups): permanently removes a 本場外援 registration.
  app.delete('/api/lineups/events/:id/guests/:registrationId', async (request, response) => {
    response.json(
      await repository.deleteGuestRegistration(
        request.params.id,
        request.params.registrationId,
        request.body?.revision,
      ),
    );
  });
  app.delete('/api/events/:id/registrations/:registrationId', async (request, response) => {
    response.json({
      registration: await notifying('cancelGuestRegistration', request.params.id, request.params.registrationId, request.body?.revision),
    });
  });
  app.get('/api/lineups/choices', async (request, response) => {
    response.set('Cache-Control', 'no-store').json(await repository.getLineupChoices(request.query));
  });
  app.get('/api/lineups/editor', async (request, response) => {
    response.set('Cache-Control', 'no-store').json(await repository.getLineupEditor(request.query.eventId));
  });
  app.get('/api/lineups/templates', async (_request, response) => {
    response.set('Cache-Control', 'no-store').json(await repository.getLineupTemplates());
  });
  app.get('/api/lineups/events/:id/current', async (request, response) => {
    const value = request.query.includeCatalogs;
    const includeCatalogs = value === undefined || value === 'false' ? false : value === 'true' ? true : value;
    response.set('Cache-Control', 'no-store').json(await repository.getLineupEvent(request.params.id, includeCatalogs));
  });
  app.get('/api/lineups/events/:id/sources', async (request, response) => {
    response.set('Cache-Control', 'no-store').json(await repository.getLineupSources(request.params.id));
  });
  app.get('/api/lineups', async (request, response) => {
    const index = await repository.getLineupIndex();
    response.set('Cache-Control', 'no-store');
    if (request.query.include !== 'default') return response.json(index);
    const result = withDefaultLineupEvent(index, { history: () => [], participation: () => null });
    if (result.selected) {
      const { eventId } = result.selected;
      result.selected.versions = (await repository.getLineupHistory(eventId)).versions;
      if (!index.events.find((event) => event.id === eventId)?.archived) {
        result.selected.participation = await repository.getEventParticipation(eventId);
      }
    }
    response.json(result);
  });
  app.get('/api/duties', async (_request, response) => {
    response.set('Cache-Control', 'no-store').json(await repository.listDuties());
  });
  app.post('/api/duties', async (request, response) => {
    response.status(201).json({ duty: await repository.addDuty(request.body) });
  });
  app.patch('/api/duties/:id', async (request, response) => {
    response.json({ duty: await repository.updateDuty(request.params.id, request.body) });
  });
  app.get('/api/lineups/events/:id', async (request, response) => {
    response.set('Cache-Control', 'no-store').json(await repository.getLineupHistory(request.params.id));
  });
  app.post('/api/lineups/confirm', async (request, response) => {
    response.status(201).json({ version: await repository.confirmLineup(request.body) });
  });
  app.post('/api/lineups/templates', async (request, response) => {
    response.status(201).json({ template: await repository.createLineupTemplate(request.body) });
  });
  app.delete('/api/lineups/templates/:id', async (request, response) => {
    response.json(await repository.deleteLineupTemplate(request.params.id));
  });
  app.get('/api/lineups/templates/:id/apply/:eventId', async (request, response) => {
    response
      .set('Cache-Control', 'no-store')
      .json(await repository.applyLineupTemplate(request.params.id, request.params.eventId));
  });
  app.get('/api/members', async (_request, response) => {
    response.set('Cache-Control', 'no-store').json(await repository.listMembers());
  });
  app.get('/api/members/:uid/maintenance', async (request, response) => {
    response.set('Cache-Control', 'no-store').json(await repository.getMemberMaintenance(request.params.uid));
  });
  app.patch('/api/members/:uid/maintenance', async (request, response) => {
    response.json(await notifying('maintainMember', request.params.uid, request.body));
  });
  app.patch('/api/members/:uid/history', async (request, response) => {
    response.json(await repository.saveMemberNameHistory(request.params.uid, request.body));
  });
  app.post('/api/members/:uid/permanent-delete', async (request, response) => {
    response.json(await repository.deleteMemberPermanently(request.params.uid, request.body));
  });
  app.get('/api/members/:uid/battle-records', async (request, response) => {
    const result = await repository.getMemberBattleRecords(request.params.uid, {
        page: request.query.page === undefined ? 1 : Number(request.query.page),
        startDate: request.query.startDate,
        endDate: request.query.endDate,
        profession: request.query.profession,
        all: request.query.all === undefined || request.query.all === 'false'
          ? false : request.query.all === 'true' ? true : request.query.all,
      });
    response.json(request.query.all === 'true' ? packPersonalBattles(result) : result);
  });
  app.post('/api/members/import/preview', async (request, response) => {
    response.set('Cache-Control', 'no-store').json(await repository.previewMemberImport(request.body));
  });
  app.post('/api/members/import', async (request, response) => {
    response.json(await notifying('importMembers', request.body));
  });
  app.post('/api/members', async (request, response) => {
    response.status(201).json({ member: await notifying('addMember', request.body) });
  });
  app.patch('/api/members/:uid', async (request, response) => {
    response.json({
      member: await notifying('updateMember', request.params.uid, request.body),
    });
  });
  app.delete('/api/members/:uid', async (request, response) => {
    response.json(
      await notifying('removeMember', request.params.uid, request.body?.revision),
    );
  });
  app.get('/api/lottery', async (_request, response) => {
    response.json(await repository.getLottery());
  });
  app.patch('/api/lottery', async (request, response) => {
    response.json(await repository.saveLottery(request.body));
  });
  app.post('/api/lottery/draws', async (request, response) => {
    response.json(await repository.drawLotteryPrize(request.body));
  });
  app.delete('/api/lottery/draws', async (request, response) => {
    response.json(await repository.resetLottery(request.body));
  });
  app.use('/api', async (_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: '找不到這個資料介面' } });
  });
  if (httpConfig.staticDir) {
    app.use('/assets', express.static(join(httpConfig.staticDir, 'assets'), {
      dotfiles: 'ignore', index: false, maxAge: '1y', immutable: true,
    }));
    app.use(express.static(httpConfig.staticDir, {
      dotfiles: 'ignore', index: 'index.html',
      setHeaders: (response) => response.setHeader('Cache-Control', 'no-store'),
    }));
  }
  app.use((error, _request, response, _next) => {
    if (
      error instanceof FileStorageError ||
      error instanceof PlatformSettingsError ||
      error instanceof AuthError ||
      error instanceof MemberError ||
      error instanceof EventError ||
      error instanceof LineupError ||
      error instanceof DutyError ||
      error instanceof ProfessionError ||
      error instanceof ParticipationError ||
      error instanceof EventVideoError ||
      error instanceof LotteryError ||
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
    if (error instanceof DatabaseError && error.status === 409) {
      return response.status(409).json({ error: { code: error.code, message: error.message } });
    }
    reportError(log, 'api_failed', error);
    if (error instanceof DatabaseError) {
      return response.status(503).json({ error: { code: 'DATABASE_ERROR', message: '資料庫暫時無法完成操作，請稍後確認操作結果' } });
    }
    response
      .status(500)
      .json({ error: { code: 'OPERATION_FAILED', message: '目前無法完成操作，請稍後再試' } });
  });
  return app;
}
