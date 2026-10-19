import { LINEUP_GROUPS, participantKey, slotAssignments } from './lineups.js';
import { eventTypeLabel } from './event-types.js';

const WIDTH = 2000;
const EXPORT_WIDTH = 5400;
const BASE_HEIGHT = 3771;
const EXPORT_SCALE = EXPORT_WIDTH / WIDTH;
const MARGIN = 16;
const GAP = 12;
const GROUP_PADDING = 8;
const NAME_SIZE = 34;
const JOB_SIZE = 30;
const NOTE_SIZE = 24;
const FONT = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
const GROUP_COLORS = { attack: '#ad353e', mobile: '#196e8c', defense: '#197661' };
const PALETTES = {
  light: {
    background: '#f4f7fb', panel: '#e8eef5', surface: '#ffffff',
    note: '#f0f4f8', border: '#bdccdc',
    text: '#16243a', muted: '#52657b',
  },
  dark: {
    background: '#101a29', panel: '#172638', surface: '#1d2c3e',
    note: '#131f30', border: '#3d5672',
    text: '#f0eadc', muted: '#a5b6cb',
  },
};

// Resolve the same live names and selected professions as the board; archives use snapshots.
export function lineupImageData({ event, teams, members, professions, duties, snapshots, status, theme = 'light' }) {
  return {
    theme: theme === 'dark' ? 'dark' : 'light',
    date: event.dates[0],
    title: `${eventTypeLabel(event.type)}${event.title ? ` · ${event.title}` : ''}`,
    status,
    groups: LINEUP_GROUPS.map((group) => ({
      id: group.id,
      name: group.name,
      teams: teams
        .filter((team) => team.id.startsWith(`${group.id}-`))
        .map((team) => ({
          name: team.name,
          rows: team.slots.map((slot) => ({
            people: slotAssignments(slot).map((entry, index) => {
              const occupied = Boolean(participantKey(entry));
              const member = snapshots
                ? entry.member
                : members.find((person) => participantKey(person) === participantKey(entry));
              const job = snapshots
                ? member?.[`${entry.profession}Profession`]
                : professions.find(
                    (job) => job.job_id === member?.[`${entry.profession}ProfessionId`],
                  );
              return {
                round: slot.secondRound ? (index === 0 ? '第一場' : '第二場') : '',
                name: occupied
                  ? member?.name || (entry.registrationId ? '報名已取消或不屬於本場' : '找不到成員')
                  : '尚未安排',
                job: occupied ? job?.name || '職業未設定' : '',
                color: job?.colorcode || '#64748b',
              };
            }),
            description:
              [
                ...(snapshots
                  ? (slot.duties || []).map((duty) => duty.name)
                  : (slot.dutyIds || []).map((id) => {
                      const duty = duties.find((duty) => duty.id === id);
                      return duty ? `${duty.name}${duty.active ? '' : '（停用）'}` : '職責不存在';
                    })),
                slot.note,
              ]
                .filter(Boolean)
                .join(' · ') || '—',
          })),
        })),
    })),
  };
}

function font(context, size, weight = 400) {
  context.font = `${weight} ${size}px ${FONT}`;
  context.textBaseline = 'top';
}
function wrap(context, value, width) {
  const lines = [];
  for (const paragraph of String(value).split(/\r?\n/)) {
    let line = '';
    for (const char of paragraph) {
      if (line && context.measureText(line + char).width > width) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}
function text(context, lines, x, y, size = 20, color = '#0f172a', weight = 400, align = 'left') {
  font(context, size, weight);
  context.fillStyle = color;
  context.textAlign = align;
  lines.forEach((line, index) => context.fillText(line, x, y + index * (size + 8)));
}
function box(context, x, y, width, height, fill, border) {
  context.fillStyle = fill;
  context.fillRect(x, y, width, height);
  context.strokeStyle = border;
  context.lineWidth = 2;
  context.strokeRect(x + 1, y + 1, width - 2, height - 2);
}
function luminance(rgb) {
  const values = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function rgb(hex) {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
}
function professionColor(value, palette) {
  if (!/^#[a-f0-9]{6}$/i.test(value || '')) return palette.text;
  const color = rgb(value);
  const background = luminance(rgb(palette.surface));
  const target = background < 0.5 ? 255 : 0;
  // Preserve the profession hue, adjusting only as much as needed for legible text.
  for (let step = 0; step <= 10; step++) {
    const mixed = color.map((channel) => Math.round(channel + (target - channel) * step / 10));
    const light = luminance(mixed);
    if ((Math.max(light, background) + 0.05) / (Math.min(light, background) + 0.05) >= 4.5)
      return '#' + mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('');
  }
  return palette.text;
}
function measureGroup(context, group) {
  const padding = GROUP_PADDING;
  const width = (WIDTH - MARGIN * 2 - padding * 2 - GAP * (group.teams.length - 1)) / group.teams.length;
  const jobWidth = width * 0.21;
  const nameWidth = width * 0.44;
  const descriptionWidth = width - jobWidth - nameWidth;
  const teams = group.teams.map((team) => {
    font(context, 27, 700);
    const title = wrap(context, team.name, width - 24);
    const rows = team.rows.map((row) => {
      const people = row.people.map((person) => {
        font(context, NAME_SIZE, 600);
        const names = wrap(context, person.name, nameWidth - 16);
        font(context, JOB_SIZE, 600);
        const jobs = wrap(context, person.job, jobWidth - 16);
        return {
          ...person, names, jobs,
          height: Math.max(names.length * (NAME_SIZE + 8), person.job ? jobs.length * (JOB_SIZE + 8) : 0) + (person.round ? 22 : 0),
        };
      });
      font(context, NOTE_SIZE);
      return { people, description: wrap(context, row.description, descriptionWidth - 24) };
    });
    return { ...team, title, rows };
  });
  const titleHeight = Math.max(...teams.map((team) => team.title.length)) * 35 + 8;
  const rowHeights = Array.from({ length: 6 }, (_, index) =>
    Math.max(52, ...teams.map((team) => Math.max(
      team.rows[index].people.reduce((height, person) => height + person.height, 0) + 8,
      team.rows[index].description.length * (NOTE_SIZE + 8) + 8,
    ))),
  );
  return {
    ...group, teams, width, jobWidth, nameWidth, descriptionWidth, titleHeight, rowHeights,
    height: padding * 2 + titleHeight + rowHeights.reduce((sum, height) => sum + height, 0),
  };
}

export async function lineupJpeg(data) {
  await document.fonts?.ready;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('瀏覽器無法產生圖片, 請換用支援 Canvas 的瀏覽器');
  const palette = PALETTES[data.theme === 'dark' ? 'dark' : 'light'];
  font(context, 38, 700);
  const heading = wrap(context, data.title, WIDTH - MARGIN * 2);
  const headerHeight = MARGIN + heading.length * 46 + 40;
  const groups = data.groups.map((group) => measureGroup(context, group));
  const contentHeight = headerHeight + groups.reduce((height, group) => height + group.height + GAP, 0) + MARGIN;
  canvas.width = EXPORT_WIDTH;
  canvas.height = Math.max(BASE_HEIGHT, Math.ceil(contentHeight * EXPORT_SCALE));
  const height = canvas.height / EXPORT_SCALE;
  // Match the reference's landscape canvas when content fits; longer content grows without clipping.
  const rowCount = groups.reduce((sum, group) => sum + group.rowHeights.length, 0);
  const extraRowHeight = rowCount ? (height - contentHeight) / rowCount : 0;
  for (const group of groups) {
    group.rowHeights = group.rowHeights.map((rowHeight) => rowHeight + extraRowHeight);
    group.height += extraRowHeight * group.rowHeights.length;
  }
  // Keep layout independent of screen size and device pixel ratio; export one sharper image.
  context.scale(EXPORT_SCALE, EXPORT_SCALE);
  context.fillStyle = palette.background;
  context.fillRect(0, 0, WIDTH, height);
  text(context, heading, WIDTH / 2, MARGIN, 38, palette.text, 700, 'center');
  const metaY = MARGIN + heading.length * 46 + 10;
  text(context, [`${data.date} · 戰場排表 · ${data.status}`], MARGIN, metaY, 21, palette.muted);
  data.groups.forEach((group, index) => {
    const x = WIDTH - MARGIN - (data.groups.length - index) * 146;
    context.fillStyle = GROUP_COLORS[group.id];
    context.fillRect(x, metaY + 5, 16, 16);
    text(context, [group.name], x + 26, metaY, 22, palette.text, 600);
  });
  let y = headerHeight;
  for (const group of groups) {
    const groupColor = GROUP_COLORS[group.id];
    box(context, MARGIN, y, WIDTH - MARGIN * 2, group.height, palette.panel, palette.border);
    group.teams.forEach((team, teamIndex) => {
      const x = MARGIN + GROUP_PADDING + teamIndex * (group.width + GAP);
      const nameX = x + group.jobWidth;
      const noteX = nameX + group.nameWidth;
      let rowY = y + GROUP_PADDING;
      box(context, x, rowY, group.width, group.titleHeight, groupColor, palette.border);
      text(context, team.title, x + group.width / 2, rowY + 4, 27, '#ffffff', 700, 'center');
      rowY += group.titleHeight;
      team.rows.forEach((row, index) => {
        const height = group.rowHeights[index];
        box(context, x, rowY, group.jobWidth, height, palette.surface, palette.border);
        box(context, nameX, rowY, group.nameWidth, height, palette.surface, palette.border);
        box(context, noteX, rowY, group.descriptionWidth, height, palette.note, palette.border);
        const contentHeight = row.people.reduce((sum, person) => sum + person.height, 0);
        let personY = rowY + (height - contentHeight) / 2;
        for (const person of row.people) {
          const labelHeight = person.round ? 22 : 0;
          if (person.round)
            text(context, [person.round], nameX + group.nameWidth / 2, personY, 16, palette.muted, 400, 'center');
          const bodyHeight = person.height - labelHeight;
          const jobY = personY + labelHeight + (bodyHeight - person.jobs.length * (JOB_SIZE + 8)) / 2;
          const nameY = personY + labelHeight + (bodyHeight - person.names.length * (NAME_SIZE + 8)) / 2;
          text(context, person.jobs, x + group.jobWidth / 2, jobY, JOB_SIZE,
            professionColor(person.color, palette), 600, 'center');
          text(context, person.names, nameX + group.nameWidth / 2, nameY, NAME_SIZE,
            person.job ? palette.text : palette.muted, person.job ? 600 : 400, 'center');
          personY += person.height;
        }
        text(context, row.description, noteX + 12, rowY + (height - row.description.length * (NOTE_SIZE + 8)) / 2,
          NOTE_SIZE, row.description[0] === '—' ? palette.muted : palette.text);
        rowY += height;
      });
    });
    y += group.height + GAP;
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  if (!blob || blob.type !== 'image/jpeg') throw new Error('JPG 產生失敗, 請再試一次');
  return blob;
}
export function lineupImageFilename(data) {
  const title = data.title
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .trim()
    .slice(0, 80);
  return `${data.date}_${title}_戰場排表.jpg`;
}
