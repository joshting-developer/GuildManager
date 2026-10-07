import './runtime-compat.js';
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
const PUBLIC = ['getEvents', 'getProfessions', 'getPlatformSettings'];
const MEMBER_MANAGEMENT = [
  'getMembers',
  'addMember',
  'updateMember',
  'removeMember',
  'previewMemberImport',
  'importMembers',
];
const PARTICIPATION = [
  'getEventParticipation',
  'getEventParticipationMembers',
  'submitParticipation',
  'submitEventVideo',
  'saveMemberResponse',
  'addGuestRegistration',
  'cancelGuestRegistration',
];
const WRITES = [
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
  'confirmLineup',
  'cancelEventLeave',
  'createLineupTemplate',
  'saveBattleRecords',
  'updateBattleRecord',
  'saveLottery',
  'drawLotteryPrize',
  'resetLottery',
  'syncBattleMembers',
];
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
function sheets(properties) {
  const id = properties.getProperty('SPREADSHEET_ID');
  if (!id || !/^[a-zA-Z0-9_-]{10,150}$/.test(id))
    fail('CONFIG_INVALID', '請先設定 SPREADSHEET_ID 並執行初始化');
  return createSheetStore({
    spreadsheet: SpreadsheetApp.openById(id),
    utilities: Utilities,
    prefix: properties.getProperty('TABLE_PREFIX') || 'GM_',
    flush: () => SpreadsheetApp.flush(),
  });
}
function cloudFolder(properties) {
  const id = properties.getProperty('DRIVE_FOLDER_ID');
  if (!id) fail('SETUP_REQUIRED', '請先執行初始化以設定私人戰績資料夾');
  return DriveApp.getFolderById(id);
}
function locked(work) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) fail('BUSY', '其他人正在儲存，請稍後重試');
  try {
    return work();
  } finally {
    lock.releaseLock();
  }
}
// Runs after the script lock is released so slow webhooks never block other writers.
function deliverNotices(notices, footer) {
  if (!notices.length) return;
  const properties = PropertiesService.getScriptProperties();
  for (const notice of notices) {
    try {
      const { channel, payload } = discordMessage(notice, {
        footer,
        timestamp: new Date().toISOString(),
      });
      const url = properties.getProperty(DISCORD_WEBHOOK_SETTINGS[channel]);
      if (!isDiscordWebhookUrl(url)) continue;
      const request = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      };
      const response = UrlFetchApp.fetch(url, request);
      if (response.getResponseCode() === 429) {
        let wait = 2000;
        try {
          wait = Math.ceil(JSON.parse(response.getContentText()).retry_after * 1000) + 250 || wait;
        } catch {}
        Utilities.sleep(Math.min(wait, 5000));
        UrlFetchApp.fetch(url, request);
      }
    } catch {
      // Saved data is authoritative; a failed notification must not fail the operation.
    }
  }
}
export function rpc(operation, args = [], context = {}) {
  const notices = [];
  let footer = DEFAULT_PLATFORM_NAME;
  try {
    const data = locked(() => {
      if (
        !Array.isArray(args) ||
        args.length > 4 ||
        !context ||
        typeof context !== 'object' ||
        Array.isArray(context)
      )
        fail('INVALID_REQUEST', '操作參數不正確');
      const { properties, options, privateStore } = environment((notice) => notices.push(notice));
      const state = privateStore.load(),
        original = canonical(state);
      const auth = createGasAuth(state, options);
      try {
        if (AUTH.includes(operation)) return auth.methods[operation](args, context);
        return sheets(properties).transaction((store) => {
          const catalog = createCatalog(store, options);
          const participation = createParticipation(store, catalog, options);
          const files = {
            decode: (value) => Utilities.base64Decode(value),
            createCsv: (name, csv) =>
              cloudFolder(properties)
                .createFile(Utilities.newBlob(csv, 'text/csv', name))
                .getId(),
            createBase64: (image) =>
              cloudFolder(properties)
                .createFile(
                  Utilities.newBlob(
                    Utilities.base64Decode(image.base64),
                    image.mimeType,
                    image.name,
                  ),
                )
                .getId(),
            read: (id) => Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes()),
          };
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
            ...createBattles(store, catalog, { ...options, files }),
            ...createLottery(store, options),
            ...createBattleMemberSync(store),
          };
          if (!Object.prototype.hasOwnProperty.call(methods, operation))
            fail('OPERATION_INVALID', '不支援此操作');
          if (['updatePlatformSettings', 'previewBattleMemberSync', 'syncBattleMembers'].includes(operation))
            auth.requireRole(context, ['admin']);
          else if (PARTICIPATION.includes(operation)) {
            const event = catalog.event(args[0], { battle: true });
            if (
              ['guild_war', 'dragon_tiger'].includes(event.type) ||
              operation === 'getEventParticipationMembers'
            )
              auth.requireRole(context, ['admin', 'manager', 'member']);
            if (args[1]?.memberUid) auth.requireRole(context, ['admin', 'manager', 'member']);
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
          else if (!PUBLIC.includes(operation)) auth.requireRole(context);
          if (WRITES.includes(operation)) auth.requireWrite(context);
          const result = methods[operation](args);
          if (notices.length)
            footer = store.get('settings', 'platform')?.name || DEFAULT_PLATFORM_NAME;
          if (operation === 'getEvents')
            return {
              events: visibleCalendarEvents(result.events, auth.session(context)?.user),
            };
          return result;
        });
      } finally {
        // Persist failed-login throttles too; no secrets are returned to clients.
        if (canonical(state) !== original) privateStore.save(state);
      }
    });
    try {
      deliverNotices(notices, footer);
    } catch {}
    return { __gasRpc: 1, ok: true, data: data ?? null };
  } catch (error) {
    return {
      __gasRpc: 1,
      ok: false,
      error: {
        code: error.code || 'GAS_ERROR',
        message: error.code ? error.message : '雲端操作失敗，請確認授權與設定後重試',
        fields: error.fields || {},
        rows: error.rows || [],
      },
    };
  }
}
export function setup() {
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
export function resetAdminPassword() {
  return locked(() => {
    const { properties, options, privateStore } = environment();
    const password = properties.getProperty('RECOVERY_ADMIN_PASSWORD');
    if (!password)
      fail(
        'RECOVERY_PASSWORD_REQUIRED',
        '請先在指令碼屬性設定 RECOVERY_ADMIN_PASSWORD（12–128 字元）',
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
