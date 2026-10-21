import { LINEUP_GROUPS, participantKey, slotAssignments } from './lineups.js';
import { eventTypeLabel } from './event-types.js';

const WIDTH = 2000;
const EXPORT_WIDTH = 5400;
const BASE_HEIGHT = 3771;
const EXPORT_SCALE = EXPORT_WIDTH / WIDTH;
const MARGIN = 16;
const GAP = 12;
const GROUP_PADDING = 6;
// Cells are inset from the grid colour so the table reads as separate tiles.
const CELL_GAP = 4;
const TITLE_SIZE = 36;
const TEAM_SIZE = 26;
const NAME_SIZE = 26;
const JOB_SIZE = 28;
const NOTE_SIZE = 22;
// Long names and jobs shrink to stay on one line before wrapping at this size.
const MIN_TEXT_SIZE = 18;
const FONT = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
const GROUP_COLORS = { attack: '#ad353e', mobile: '#196e8c', defense: '#197661' };
const PALETTES = {
  light: {
    background: '#eef2f7', grid: '#c5d2e1', surface: '#ffffff',
    note: '#f5f8fb', text: '#1e2b3d', muted: '#6b7c90', title: '#1e2b3d',
  },
  // 米黃 export matches the sepia site theme: warm paper with brown title text.
  sepia: {
    background: '#f1e9d8', grid: '#d8c9a8', surface: '#fbf6ea',
    note: '#f4ecda', text: '#3b3225', muted: '#7a6b52', title: '#6b4a14',
  },
  dark: {
    background: '#121b2a', grid: '#2c4262', surface: '#1b2639',
    note: '#172133', text: '#f0e6cf', muted: '#93a4ba', title: '#e3c27a',
  },
};

// Resolve the same live names and selected professions as the board; archives use snapshots.
export function lineupImageData({ event, teams, members, professions, duties, snapshots, status, theme = 'light' }) {
  return {
    theme: PALETTES[theme] ? theme : 'light',
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
                  : '—',
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
// Prefer one line at a smaller size; wrap only when even the minimum size does not fit.
function fit(context, value, width, size, weight) {
  for (let current = size; current > MIN_TEXT_SIZE; current -= 2) {
    font(context, current, weight);
    if (context.measureText(value).width <= width) return { size: current, lines: [value] };
  }
  font(context, MIN_TEXT_SIZE, weight);
  return { size: MIN_TEXT_SIZE, lines: wrap(context, value, width) };
}
function text(context, lines, x, y, size = 20, color = '#0f172a', weight = 400, align = 'left') {
  font(context, size, weight);
  context.fillStyle = color;
  context.textAlign = align;
  lines.forEach((line, index) => context.fillText(line, x, y + index * (size + 8)));
}
function cell(context, x, y, width, height, fill) {
  context.fillStyle = fill;
  context.fillRect(x + CELL_GAP / 2, y + CELL_GAP / 2, width - CELL_GAP, height - CELL_GAP);
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
// Profession and group colours keep their hue; they are only mixed toward white/black
// until text reaches the requested WCAG ratio (profession and legend text use 4.5:1).
function readableColor(value, backgroundHex, fallback, ratio = 4.5) {
  if (!/^#[a-f0-9]{6}$/i.test(value || '')) return fallback;
  const color = rgb(value);
  const background = luminance(rgb(backgroundHex));
  const target = background < 0.5 ? 255 : 0;
  for (let step = 0; step <= 20; step++) {
    const mixed = color.map((channel) => Math.round(channel + (target - channel) * step / 20));
    const light = luminance(mixed);
    if ((Math.max(light, background) + 0.05) / (Math.min(light, background) + 0.05) >= ratio)
      return '#' + mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('');
  }
  return fallback;
}
function pillText(fill) {
  const contrast = (hex) => {
    const [a, b] = [luminance(rgb(hex)), luminance(rgb(fill))];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  return contrast('#ffffff') >= contrast('#16202e') ? '#ffffff' : '#16202e';
}
function jobPills(context, job, color, centerX, y, palette) {
  const fill = /^#[a-f0-9]{6}$/i.test(color || '') ? color : palette.muted;
  font(context, job.size, 500);
  job.lines.forEach((line, index) => {
    const width = context.measureText(line).width + job.size * 0.8;
    const top = y + index * (job.size + 8) - 4;
    context.fillStyle = fill;
    if (typeof context.roundRect === 'function') {
      context.beginPath();
      context.roundRect(centerX - width / 2, top, width, job.size + 8, (job.size + 8) / 2);
      context.fill();
    } else context.fillRect(centerX - width / 2, top, width, job.size + 8);
  });
  text(context, job.lines, centerX, y, job.size, pillText(fill), 500, 'center');
}
function measureGroup(context, group) {
  const padding = GROUP_PADDING;
  const width = (WIDTH - MARGIN * 2 - padding * 2 - GAP * (group.teams.length - 1)) / group.teams.length;
  const jobWidth = width * 0.21;
  const nameWidth = width * 0.44;
  const descriptionWidth = width - jobWidth - nameWidth;
  const teams = group.teams.map((team) => {
    font(context, TEAM_SIZE, 600);
    const title = wrap(context, team.name, width - 24);
    const rows = team.rows.map((row) => {
      const people = row.people.map((person) => {
        const name = fit(context, person.name, nameWidth - 24, NAME_SIZE, person.job ? 500 : 400);
        const job = person.job
          ? fit(context, person.job, jobWidth - 44, JOB_SIZE, 500)
          : { size: JOB_SIZE, lines: [] };
        return {
          ...person, name, job,
          height: Math.max(name.lines.length * (name.size + 8), job.lines.length * (job.size + 8)) + (person.round ? 22 : 0),
        };
      });
      font(context, NOTE_SIZE);
      return { people, description: wrap(context, row.description, descriptionWidth - 28) };
    });
    return { ...team, title, rows };
  });
  const titleHeight = Math.max(...teams.map((team) => team.title.length)) * (TEAM_SIZE + 8) + 12;
  const rowHeights = Array.from({ length: 6 }, (_, index) =>
    Math.max(56, ...teams.map((team) => Math.max(
      team.rows[index].people.reduce((height, person) => height + person.height, 0) + 16,
      team.rows[index].description.length * (NOTE_SIZE + 8) + 16,
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
  const palette = PALETTES[data.theme] || PALETTES.light;
  // One header row like a table: date/status left, title centred, colour legend right.
  const SIDE = 520;
  font(context, TITLE_SIZE, 600);
  const heading = wrap(context, data.title, WIDTH - MARGIN * 2 - SIDE * 2);
  const headingHeight = heading.length * (TITLE_SIZE + 8) - 8;
  const headerHeight = MARGIN + headingHeight + 20;
  const groups = data.groups.map((group) => measureGroup(context, group));
  const contentHeight = headerHeight + groups.reduce((height, group) => height + group.height + GAP, 0) + MARGIN - GAP;
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
  text(context, heading, WIDTH / 2, MARGIN, TITLE_SIZE, palette.title, 600, 'center');
  const sideY = MARGIN + (headingHeight - 22) / 2;
  text(context, [`${data.date} · ${data.status}`], MARGIN + 4, sideY + 1, 21, palette.muted);
  font(context, 24, 600);
  let legendX = WIDTH - MARGIN - 4;
  for (const group of [...data.groups].reverse()) {
    text(context, [`■ ${group.name}`], legendX, sideY - 1, 24,
      readableColor(GROUP_COLORS[group.id], palette.background, palette.text, 4.5), 600, 'right');
    font(context, 24, 600);
    legendX -= context.measureText(`■ ${group.name}`).width + 28;
  }
  // Light and sepia backgrounds would have to darken pale profession colours into mud;
  // there each job sits on a pill of its true colour instead. Dark exports keep coloured text.
  const pillJobs = luminance(rgb(palette.surface)) >= 0.5;
  let y = headerHeight;
  for (const group of groups) {
    const groupColor = GROUP_COLORS[group.id];
    context.fillStyle = palette.grid;
    context.fillRect(MARGIN, y, WIDTH - MARGIN * 2, group.height);
    group.teams.forEach((team, teamIndex) => {
      const x = MARGIN + GROUP_PADDING + teamIndex * (group.width + GAP);
      const nameX = x + group.jobWidth;
      const noteX = nameX + group.nameWidth;
      let rowY = y + GROUP_PADDING;
      cell(context, x, rowY, group.width, group.titleHeight, groupColor);
      text(context, team.title, x + group.width / 2, rowY + 6, TEAM_SIZE, '#ffffff', 600, 'center');
      rowY += group.titleHeight;
      team.rows.forEach((row, index) => {
        const height = group.rowHeights[index];
        cell(context, x, rowY, group.jobWidth, height, palette.surface);
        cell(context, nameX, rowY, group.nameWidth, height, palette.surface);
        cell(context, noteX, rowY, group.descriptionWidth, height, palette.note);
        const contentHeight = row.people.reduce((sum, person) => sum + person.height, 0);
        let personY = rowY + (height - contentHeight) / 2;
        for (const person of row.people) {
          const labelHeight = person.round ? 22 : 0;
          if (person.round)
            text(context, [person.round], nameX + group.nameWidth / 2, personY, 16, palette.muted, 400, 'center');
          const bodyHeight = person.height - labelHeight;
          const { name, job } = person;
          const jobY = personY + labelHeight + (bodyHeight - job.lines.length * (job.size + 8) + 8) / 2;
          const nameY = personY + labelHeight + (bodyHeight - name.lines.length * (name.size + 8) + 8) / 2;
          if (pillJobs) jobPills(context, job, person.color, x + group.jobWidth / 2, jobY, palette);
          else
            text(context, job.lines, x + group.jobWidth / 2, jobY, job.size,
              readableColor(person.color, palette.surface, palette.text), 500, 'center');
          text(context, name.lines, nameX + group.nameWidth / 2, nameY, name.size,
            person.job ? palette.text : palette.muted, person.job ? 500 : 400, 'center');
          personY += person.height;
        }
        text(context, row.description, noteX + 14, rowY + (height - row.description.length * (NOTE_SIZE + 8) + 8) / 2,
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
