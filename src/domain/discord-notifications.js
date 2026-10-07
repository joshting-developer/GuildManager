import { eventDisplayTitle, eventTypeLabel } from './event-types.js';

// Same property names for local env vars and GAS Script Properties.
export const DISCORD_WEBHOOK_SETTINGS = {
  leave: 'DISCORD_WEBHOOK_LEAVE',
  member: 'DISCORD_WEBHOOK_MEMBER',
};

// Only official Discord webhook endpoints; never post to arbitrary configured URLs.
export function isDiscordWebhookUrl(value) {
  return (
    typeof value === 'string' &&
    /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{1,25}\/[\w-]{1,100}$/.test(
      value,
    )
  );
}

const COLORS = { red: 15158332, green: 3066993, blue: 3447003 };
const LEAVE_STATES = {
  leave: { title: '🏳️ 出席狀況更新', status: '已請假', color: COLORS.red },
  reregister: { title: '✅ 出席狀況更新', status: '已改回報名', color: COLORS.green },
  cancel: { title: '✅ 出席狀況更新', status: '管理者已取消請假', color: COLORS.green },
};
const MEMBER_ACTIONS = {
  add: { title: '➕ 幫眾名冊：新增', color: COLORS.green },
  update: { title: '✏️ 幫眾名冊：更新', color: COLORS.blue },
  remove: { title: '📤 幫眾名冊：移至編外', color: COLORS.red },
};

// Player-supplied names must not turn into Discord markdown.
function plain(value, max = 1024) {
  const text = String(value ?? '').replace(/[\\*_~`|>[\]]/g, '\\$&');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text || '—';
}
function membership(member) {
  const labels = [member.isInGuild && '幫會', member.isInClub && '俱樂部'].filter(Boolean);
  return labels.length ? labels.join('／') : '編外';
}
function professions(member) {
  return [member.primaryProfession, member.secondaryProfession].filter(Boolean).join('／') || '—';
}

export function discordMessage(notice, { footer, timestamp }) {
  const base = { footer: { text: plain(footer || '幫會管理平台', 2048) }, timestamp };
  if (notice.type === 'leave') {
    const state = LEAVE_STATES[notice.action];
    const event = notice.event;
    const label = `${event.date.replace(/-/g, '/')} · ${eventTypeLabel(event.type)}${
      event.title ? ` · ${eventDisplayTitle(event)}` : ''
    }`;
    return {
      channel: 'leave',
      payload: {
        allowed_mentions: { parse: [] },
        embeds: [
          {
            ...base,
            title: state.title,
            color: state.color,
            fields: [
              { name: '場次', value: plain(label), inline: false },
              {
                name: '玩家',
                value: `**${plain(notice.name, 200)}**${notice.profession ? `（${plain(notice.profession, 40)}）` : ''}`,
                inline: false,
              },
              { name: '狀態', value: `**${state.status}**`, inline: false },
            ],
          },
        ],
      },
    };
  }
  if (notice.type === 'member') {
    const action = MEMBER_ACTIONS[notice.action];
    const member = notice.member;
    const fields = [
      { name: '玩家', value: `**${plain(member.name, 200)}**`, inline: true },
      { name: '職業', value: plain(professions(member)), inline: true },
      { name: '所屬', value: membership(member), inline: true },
      { name: 'UID', value: plain(member.uid), inline: false },
    ];
    if (notice.previousName && notice.previousName !== member.name)
      fields.splice(1, 0, { name: '原名稱', value: plain(notice.previousName, 200), inline: true });
    return {
      channel: 'member',
      payload: {
        allowed_mentions: { parse: [] },
        embeds: [{ ...base, title: action.title, color: action.color, fields }],
      },
    };
  }
  if (notice.type === 'member-import') {
    // One summary per import keeps large CSV batches under Discord's rate limits.
    const names = notice.members.map((member) => plain(member.name, 200)).join('、');
    return {
      channel: 'member',
      payload: {
        allowed_mentions: { parse: [] },
        embeds: [
          {
            ...base,
            title: '📥 幫眾名冊：匯入',
            color: COLORS.green,
            description: names.length > 4000 ? `${names.slice(0, 3999)}…` : names || '—',
            fields: [
              { name: '新增', value: String(notice.summary.added), inline: true },
              { name: '重新加入', value: String(notice.summary.restored), inline: true },
              { name: '略過', value: String(notice.summary.skipped), inline: true },
            ],
          },
        ],
      },
    };
  }
  throw new Error(`Unknown notification type: ${notice.type}`);
}

export function leaveNotice(previousStatus, nextStatus) {
  if (previousStatus === nextStatus) return null;
  if (nextStatus === 'leave') return 'leave';
  if (previousStatus !== 'leave') return null;
  return nextStatus === 'registered' ? 'reregister' : 'cancel';
}
