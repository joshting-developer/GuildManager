import './runtime-compat.js';
import { createMemberMaintenance } from './member-maintenance.js';
import { visibleCalendarEvents } from '../../src/domain/calendar-access.js';
import {
  DEFAULT_PLATFORM_NAME,
  validatePlatformSettings,
  validatePlatformIcon,
  platformIconSource,
} from '../../src/domain/platform-settings.js';
import { canonical, fail } from './common.js';
import { createSheetStore, createPrivateStore } from './storage.js';
import { createGasAuth } from './auth.js';
import { createCatalog, PROFESSIONS } from './members-events.js';
import { createLineups } from './lineups.js';
import { createBattles } from './battles.js';
import { createParticipation } from './participation.js';
import { createVideos } from './videos.js';
import { createLottery } from './lottery.js';
import {
  DISCORD_WEBHOOK_SETTINGS,
  discordMessage,
  isDiscordWebhookUrl,
} from '../../src/domain/discord-notifications.js';
import { createBattleMemberSync } from './battle-member-sync.js';
import { createBattleUploadDiagnostics } from './battle-upload-diagnostics.js';

const AUTH = [
  'getAuthSession',
  'login',
  'loginMember',
  'logout',
  'getAccountSettings',
  'changeAdminPassword',
  'createManager',
  'updateManager',
  'setMemberToken',
];
const PUBLIC = ['getEvents', 'getEvent', 'getProfessions', 'getPlatformSettings'];
const MEMBER_MANAGEMENT = [
  'getMembers',
  'addMember',
  'updateMember',
  'previewMemberImport',
  'importMembers',
];
const PARTICIPATION = [
  'getEventParticipation',
  'getEventParticipationMembers',
  'getEventParticipationForm',
  'submitParticipation',
  'submitEventVideo',
  'saveMemberResponse',
  'addGuestRegistration',
  'cancelGuestRegistration',
];
const WRITES = [
  'maintainMember',
  'saveMemberNameHistory',
  'deleteMemberPermanently',
  'updatePlatformSettings',
  'addMember',
  'updateMember',
  'removeMember',
  'importMembers',
  'createEvent',
  'updateEvent',
  'deleteEvent',
  'addDuty',
  'updateDuty',
  'submitParticipation',
  'submitEventVideo',
  'saveMemberResponse',
  'addGuestRegistration',
  'cancelGuestRegistration',
  'deleteGuestRegistration',
  'confirmLineup',
  'cancelEventLeave',
  'createLineupTemplate',
  'saveBattleRecords',
  'updateBattleRecord',
  'deleteBattleRecord',
  'saveLottery',
  'drawLotteryPrize',
  'resetLottery',
  'syncBattleMembers',
];
// Explicit allowlist: newly added methods remain serialized until audited.
const READ_ONLY = [
  'getAuthSession', 'getAccountSettings', 'getHomeData', 'getPlatformSettings',
  'getProfessions', 'getMembers', 'getParticipationMembers', 'previewMemberImport',
  'getMemberMaintenance', 'getEvents', 'getEvent', 'getDuties',
  'getEventParticipation', 'getEventParticipationForm', 'getEventParticipationMembers',
  'getEventAttendance', 'getLineupIndex', 'getLineupHistory', 'applyLineupTemplate',
  'getBattleRecords', 'getBattleRecord', 'getBattleTeamAnalysis', 'getMemberBattleRecords',
  'getBattleAttachment', 'previewBattleMemberSync', 'getEventVideos', 'getLottery',
];
const LAZY_TABLE_READS = ['getEventVideos', 'getLottery'];
function environment(notify = () => {}) {
  const properties = PropertiesService.getScriptProperties();
  const options = {
    notify,
    uuid: () => Utilities.getUuid(),
    now: () => new Date().toISOString(),
    secret: properties.getProperty('AUTH_SECRET'),
    guildName: properties.getProperty('GUILD_NAME') || '你的幫會',
  };
  const privateStore = createPrivateStore(properties, options.uuid);
  return { properties, options, privateStore };
}
function sheets(properties, run) {
  const id = properties.getProperty('SPREADSHEET_ID');
  if (!id || !/^[a-zA-Z0-9_-]{10,150}$/.test(id))
    fail('CONFIG_INVALID', '請先設定 SPREADSHEET_ID 並執行初始化');
  return createSheetStore({
    spreadsheet: SpreadsheetApp.openById(id),
    utilities: Utilities,
    prefix: properties.getProperty('TABLE_PREFIX') || 'GM_',
    flush: () => SpreadsheetApp.flush(),
    run,
  });
}
function cloudFolder(properties) {
  const id = properties.getProperty('DRIVE_FOLDER_ID');
  if (!id) fail('SETUP_REQUIRED', '請先執行初始化以設定私人戰績資料夾');
  return DriveApp.getFolderById(id);
}
function cloudFiles(properties, run, cache) {
  return {
    decode: (value) => Utilities.base64Decode(value),
    createCsv: (name, csv) => run('DRIVE_CSV', () =>
      cloudFolder(properties).createFile(Utilities.newBlob(csv, 'text/csv', name)).getId()),
    createBase64: (image) => run('DRIVE_IMAGE', () => {
      const id = cloudFolder(properties).createFile(Utilities.newBlob(
        Utilities.base64Decode(image.base64), image.mimeType, image.name,
      )).getId();
      cache?.set(id, image.base64);
      return id;
    }),
    read: (id) => {
      if (cache?.has(id)) return cache.get(id);
      const value = Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes());
      cache?.set(id, value);
      return value;
    },
  };
}
function locked(work) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) fail('BUSY', '目前操作較忙碌，請稍後再試；已填內容會保留');
  try {
    return work();
  } finally {
    lock.releaseLock();
  }
}
// Pasted Script Property values often carry a trailing space or newline.
function webhookUrl(properties, name) {
  return (properties.getProperty(name) || '').trim();
}
function logDiscordFailure(channel, reason, status = null) {
  // Exceptions and response bodies may contain webhook credentials or player input.
  // Only fixed categories and numeric HTTP status codes belong in the execution log.
  const setting = DISCORD_WEBHOOK_SETTINGS[channel] || 'DISCORD_WEBHOOK';
  const http = Number.isInteger(status) ? `（HTTP ${status}）` : '';
  try {
    Logger.log(`Discord 通知失敗：${setting} · ${reason}${http}`);
  } catch {
    // Diagnostic failures must never change a committed operation's result.
  }
}
// Runs after the script lock is released so slow webhooks never block other writers.
function deliverNotices(notices, footer) {
  if (!notices.length) return;
  const properties = PropertiesService.getScriptProperties();
  for (const notice of notices) {
    let channel;
    try {
      const message = discordMessage(notice, {
        footer,
        timestamp: new Date().toISOString(),
      });
      channel = message.channel;
      const url = webhookUrl(properties, DISCORD_WEBHOOK_SETTINGS[channel]);
      // An unset optional channel keeps its existing silent, disabled behavior.
      if (!url) continue;
      if (!isDiscordWebhookUrl(url)) {
        logDiscordFailure(channel, 'WEBHOOK_INVALID');
        continue;
      }
      const request = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(message.payload),
        muteHttpExceptions: true,
      };
      let response = UrlFetchApp.fetch(url, request);
      if (response.getResponseCode() === 429) {
        let wait = 2000;
        try {
          wait = Math.ceil(JSON.parse(response.getContentText()).retry_after * 1000) + 250 || wait;
        } catch {}
        Utilities.sleep(Math.min(Math.max(wait, 0), 5000));
        response = UrlFetchApp.fetch(url, request);
      }
      const status = response.getResponseCode();
      if (status < 200 || status >= 300) logDiscordFailure(channel, 'HTTP_ERROR', status);
    } catch {
      // Saved data is authoritative; a failed notification must not fail the operation.
      logDiscordFailure(channel, 'REQUEST_EXCEPTION（請檢查授權或網路）');
    }
  }
}
// doGet runs on every page open; reading Sheets and the Drive icon there costs seconds.
// Cache the public branding (script-wide) and clear it whenever settings change.
const PLATFORM_CACHE_KEY = 'gm:platform:v1';
const PLATFORM_CACHE_SECONDS = 6 * 60 * 60;
function scriptCache() {
  try {
    return typeof CacheService === 'undefined' ? null : CacheService.getScriptCache();
  } catch {
    return null;
  }
}
function forgetPlatform() {
  try {
    scriptCache()?.remove(PLATFORM_CACHE_KEY);
  } catch {}
}
export function pagePlatform() {
  const cache = scriptCache();
  try {
    const hit = cache?.get(PLATFORM_CACHE_KEY);
    if (hit) return JSON.parse(hit);
  } catch {}
  const result = rpc('getPlatformSettings', []);
  if (!result.ok) return null;
  // Values over the 100 KB cache limit (large icons) simply stay uncached.
  try {
    cache?.put(PLATFORM_CACHE_KEY, JSON.stringify(result.data.platform), PLATFORM_CACHE_SECONDS);
  } catch {}
  return result.data.platform;
}
export function rpc(operation, args = [], context = {}) {
  const notices = [];
  const diagnostics = operation === 'saveBattleRecords' ? createBattleUploadDiagnostics() : null;
  const run = diagnostics?.run || ((_stage, work) => work());
  let footer = DEFAULT_PLATFORM_NAME;
  try {
    const fileCache = new Map();
    const execute = ({ readOnly = false, prepareOnly = false, preparedFiles, preparedUpload } = {}) => {
      if (
        !Array.isArray(args) ||
        args.length > 4 ||
        !context ||
        typeof context !== 'object' ||
        Array.isArray(context)
      )
        fail('INVALID_REQUEST', '操作參數不正確');
      if (operation === 'getAuthSession' && !context.sessionToken) return { user: null };
      const { properties, options, privateStore } = run('SETTINGS', () => environment((notice) => notices.push(notice)));
      const state = run('AUTH_READ', () => privateStore.load()),
        original = canonical(state);
      const auth = createGasAuth(state, options);
      try {
        if (AUTH.includes(operation)) return auth.methods[operation](args, context);
        return run('SHEETS_OPEN', () => sheets(properties, run)).transaction((store) => {
          const catalog = createCatalog(store, options);
          const participation = createParticipation(store, catalog, options);
          const files = preparedFiles || cloudFiles(properties, run, fileCache);
          const methods = {
            getPlatformSettings: () => {
              const settings = store.get('settings', 'platform') || {
                name: DEFAULT_PLATFORM_NAME,
                revision: 1,
              };
              const iconSrc = settings.icon
                ? platformIconSource({
                    mimeType: settings.icon.mimeType,
                    base64: files.read(settings.icon.fileId),
                  })
                : null;
              return {
                platform: {
                  name: settings.name,
                  revision: settings.revision,
                  ...(iconSrc ? { iconSrc } : {}),
                },
              };
            },
            updatePlatformSettings: ([input]) => {
              const current = methods.getPlatformSettings().platform;
              const name = validatePlatformSettings(input, current);
              const hasIcon = Object.prototype.hasOwnProperty.call(input, 'icon');
              const image = hasIcon ? validatePlatformIcon(input.icon) : null;
              const iconChanged =
                hasIcon && platformIconSource(image) !== (current.iconSrc || null);
              if (prepareOnly) return name === current.name && !iconChanged
                ? { completed: true, result: methods.getPlatformSettings() }
                : { completed: false, plan: {
                    csvFiles: [],
                    image: iconChanged && image
                      ? { ...image, name: `platform-icon-${options.uuid()}` }
                      : null,
                  } };
              if (name !== current.name || iconChanged) {
                const saved = store.get('settings', 'platform') || current;
                const icon = iconChanged
                  ? image
                    ? {
                        mimeType: image.mimeType,
                        fileId: files.createBase64({
                          ...image,
                          name: `platform-icon-${options.uuid()}`,
                        }),
                      }
                    : null
                  : saved.icon || null;
                store.put('settings', 'platform', {
                  name,
                  icon,
                  revision: current.revision + 1,
                });
              }
              return methods.getPlatformSettings();
            },
            ...catalog.methods,
            ...participation.methods,
            ...createVideos(store, catalog, options),
            ...createLineups(store, catalog, participation, options),
            ...createBattles(store, catalog, { ...options, files, prepareOnly, preparedUpload }),
            ...createLottery(store, options),
            ...createBattleMemberSync(store),
            ...createMemberMaintenance(store, catalog, options),
          };
          if (!Object.prototype.hasOwnProperty.call(methods, operation))
            fail('OPERATION_INVALID', '不支援此操作');
          if (['updatePlatformSettings', 'previewBattleMemberSync', 'syncBattleMembers'].includes(operation))
            auth.requireRole(context, ['admin']);
          else if (PARTICIPATION.includes(operation)) {
            catalog.event(args[0], { battle: true });
          } else if (
            operation === 'getParticipationMembers' ||
            MEMBER_MANAGEMENT.includes(operation)
          )
            auth.requireRole(context, ['admin', 'manager', 'member']);
          else if (
            [
              'getBattleRecords',
              'getBattleRecord',
              'getBattleTeamAnalysis',
              'getBattleAttachment',
              'getMemberBattleRecords',
            ].includes(operation)
          )
            auth.requireRole(context, ['admin', 'manager', 'member']);
          else if (!PUBLIC.includes(operation)) run('AUTH_CHECK', () => auth.requireRole(context));
          if (WRITES.includes(operation)) run('AUTH_CHECK', () => auth.requireWrite(context));
          const result = run('PROCESS', () => methods[operation](args));
          if (notices.length)
            footer = store.get('settings', 'platform')?.name || DEFAULT_PLATFORM_NAME;
          if (operation === 'getEvents')
            return {
              events: visibleCalendarEvents(result.events, auth.session(context)?.user),
            };
          return result;
        }, { readOnly });
      } finally {
        // Persist failed-login throttles too; no secrets are returned to clients.
        if (canonical(state) !== original) {
          if (readOnly) fail('READ_ONLY', '唯讀操作不能修改登入資料');
          run('AUTH_SAVE', () => privateStore.save(state));
        }
      }
    };
    let data;
    if (READ_ONLY.includes(operation)) {
      try {
        data = execute({ readOnly: true });
      } catch (error) {
        // Old projects gain optional tables once, with permission checks repeated
        // under the writer lock. Ordinary reads never create or modify a sheet.
        if (error.code !== 'TABLE_INITIALIZATION_REQUIRED' || !LAZY_TABLE_READS.includes(operation)) throw error;
        data = run('LOCK', () => locked(() => execute()));
      }
    } else if (['saveBattleRecords', 'updatePlatformSettings'].includes(operation)) {
      const prepared = execute({ readOnly: true, prepareOnly: true });
      if (prepared.completed) data = prepared.result;
      else {
        const files = cloudFiles(PropertiesService.getScriptProperties(), run, fileCache);
        const csvFiles = prepared.plan.csvFiles.map((file) => ({ ...file, id: files.createCsv(file.name, file.csv) }));
        const imageId = prepared.plan.image ? files.createBase64(prepared.plan.image) : null;
        let csvIndex = 0;
        const preparedFiles = {
          ...files,
          createCsv: (name, csv) => {
            const file = csvFiles[csvIndex++];
            if (!file || file.name !== name || file.csv !== csv) fail('INVALID_REQUEST', '附件內容已變更，請重新送出');
            return file.id;
          },
          createBase64: (image) => {
            if (!imageId || image.base64 !== prepared.plan.image.base64 || image.mimeType !== prepared.plan.image.mimeType)
              fail('INVALID_REQUEST', '附件內容已變更，請重新送出');
            return imageId;
          },
          read: (id) => {
            if (!fileCache.has(id)) fail('STALE_SETTINGS', '平台設定已被修改，請重新載入後再儲存');
            return fileCache.get(id);
          },
        };
        // Reopen the latest committed snapshot and repeat auth, validation and
        // requestId/uniqueness checks. Only file preparation escapes the lock.
        data = run('LOCK', () => locked(() => execute({ preparedFiles, preparedUpload: prepared.plan })));
      }
    } else data = run('LOCK', () => locked(() => execute()));
    try {
      deliverNotices(notices, footer);
    } catch {
      logDiscordFailure(null, 'DELIVERY_EXCEPTION');
    }
    if (operation === 'updatePlatformSettings') forgetPlatform();
    return { __gasRpc: 1, ok: true, data: data ?? null };
  } catch (error) {
    return {
      __gasRpc: 1,
      ok: false,
      error: {
        code: error.code || 'GAS_ERROR',
        message: error.code ? error.message : diagnostics
          ? diagnostics.report(error)
          : '雲端操作失敗，請確認授權與設定後重試',
        fields: error.fields || {},
        rows: error.rows || [],
      },
    };
  }
}
export function setup() {
  forgetPlatform();
  return locked(() => {
    const { properties, options, privateStore } = environment();
    const state = privateStore.load(),
      auth = createGasAuth(state, options);
    auth.bootstrap({
      username: properties.getProperty('BOOTSTRAP_ADMIN_USERNAME'),
      password: properties.getProperty('BOOTSTRAP_ADMIN_PASSWORD'),
    });
    const storage = sheets(properties);
    storage.initialize();
    if (!properties.getProperty('DRIVE_FOLDER_ID')) {
      const folder = DriveApp.createFolder('GuildManager 戰績原始檔');
      properties.setProperty('DRIVE_FOLDER_ID', folder.getId());
    }
    DriveApp.getFolderById(properties.getProperty('DRIVE_FOLDER_ID'));
    storage.transaction((store) => {
      for (const job of PROFESSIONS)
        if (!store.get('professions', job.job_id)) store.put('professions', job.job_id, job);
      for (const [index, name] of ['保鑣', '山盟', '輔潮'].entries()) {
        const id = `default-duty-${index + 1}`;
        if (!store.get('duties', id))
          store.put('duties', id, {
            id,
            name,
            active: true,
            revision: 1,
            createdAt: options.now(),
            updatedAt: options.now(),
          });
      }
    });
    privateStore.save(state);
    properties.deleteProperty('BOOTSTRAP_ADMIN_PASSWORD');
    return {
      initialized: true,
      tablesPrefix: properties.getProperty('TABLE_PREFIX') || 'GM_',
      professions: 9,
      message: '初始化完成；請先以測試部署確認功能，再正式部署',
    };
  });
}

// Caller is the Google-identity-guarded wrapper in Code.gs; not in the RPC allowlist.
// Editor-only check: posts one test message per configured channel and reports the HTTP
// status, without the URL, so a webhook can be verified outside the web app.
export function testDiscordWebhooks() {
  const properties = PropertiesService.getScriptProperties();
  return Object.entries(DISCORD_WEBHOOK_SETTINGS).map(([channel, name]) => {
    const url = webhookUrl(properties, name);
    if (!isDiscordWebhookUrl(url)) return `${name}：未設定或不是 Discord webhook 網址`;
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        allowed_mentions: { parse: [] },
        content: `🔔 GuildManager 測試通知（${channel === 'leave' ? '請假' : '名冊'}頻道）`,
      }),
      muteHttpExceptions: true,
    });
    const status = response.getResponseCode();
    return `${name}：${status >= 200 && status < 300 ? '成功' : '失敗'}（HTTP ${status}）`;
  });
}
export function resetAdminPassword() {
  return locked(() => {
    const { properties, options, privateStore } = environment();
    const password = properties.getProperty('RECOVERY_ADMIN_PASSWORD');
    if (!password)
      fail(
        'RECOVERY_PASSWORD_REQUIRED',
        '請先在指令碼屬性設定 RECOVERY_ADMIN_PASSWORD（6–128 字元）',
      );
    const state = privateStore.load();
    const auth = createGasAuth(state, options);
    const admin = auth.resetAdminPassword(password);
    privateStore.save(state);
    properties.deleteProperty('RECOVERY_ADMIN_PASSWORD');
    return {
      reset: true,
      username: admin.username,
      message: `admin 密碼已重設，登入帳號：${admin.username}；請重新整理網站後使用新密碼登入`,
    };
  });
}
