import { LINEUP_GROUPS, participantKey, slotAssignments } from './lineups.js';
import { eventTypeLabel } from './event-types.js';

const WIDTH = 2000;
const MARGIN = 32;
const GAP = 20;
const FONT = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
const COLORS = {
  attack: { text: '#b91c1c', background: '#fef2f2' },
  mobile: { text: '#0369a1', background: '#f0f9ff' },
  defense: { text: '#047857', background: '#ecfdf5' },
};

// Resolve the same live names and selected professions as the board; archives use snapshots.
export function lineupImageData({ event, teams, members, professions, duties, snapshots, status }) {
  return {
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
                job: occupied
                  ? `${job?.name || '職業未設定'}${entry.profession === 'secondary' ? '（副）' : ''}`
                  : '',
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
function text(context, lines, x, y, size = 20, color = '#0f172a', weight = 400) {
  font(context, size, weight);
  context.fillStyle = color;
  lines.forEach((line, index) => context.fillText(line, x, y + index * (size + 8)));
}
function box(context, x, y, width, height, fill = '#ffffff') {
  context.fillStyle = fill;
  context.fillRect(x, y, width, height);
  context.strokeStyle = '#e2e8f0';
  context.lineWidth = 1;
  context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
}
function measureGroup(context, group) {
  const width = (WIDTH - MARGIN * 2 - GAP * (group.teams.length - 1)) / group.teams.length;
  const peopleWidth = width * 0.62;
  const teams = group.teams.map((team) => {
    font(context, 20, 700);
    const title = wrap(context, team.name, width - 24);
    const rows = team.rows.map((row) => {
      const people = row.people.map((person) => {
        font(context, 20, person.job ? 600 : 400);
        return { ...person, names: wrap(context, person.name, peopleWidth - 56) };
      });
      font(context, 20);
      return { people, description: wrap(context, row.description, width - peopleWidth - 24) };
    });
    return { ...team, title, rows };
  });
  const titleHeight = Math.max(...teams.map((team) => team.title.length)) * 28 + 24;
  const rowHeights = Array.from({ length: 6 }, (_, index) =>
    Math.max(
      66,
      ...teams.map((team) =>
        Math.max(
          team.rows[index].people.reduce(
            (height, person) =>
              height +
              (person.round ? 24 : 0) +
              (person.job ? 24 : 0) +
              person.names.length * 28 +
              12,
            0,
          ) + 16,
          team.rows[index].description.length * 28 + 24,
        ),
      ),
    ),
  );
  return {
    ...group,
    teams,
    width,
    peopleWidth,
    titleHeight,
    rowHeights,
    height: 52 + titleHeight + 40 + rowHeights.reduce((sum, height) => sum + height, 0),
  };
}

export async function lineupJpeg(data) {
  await document.fonts?.ready;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('瀏覽器無法產生圖片, 請換用支援 Canvas 的瀏覽器');
  font(context, 30, 700);
  const heading = wrap(context, data.title, WIDTH - MARGIN * 2);
  const headerHeight = 84 + heading.length * 38;
  const groups = data.groups.map((group) => measureGroup(context, group));
  canvas.width = WIDTH;
  canvas.height =
    headerHeight + groups.reduce((height, group) => height + group.height + GAP, 0) + MARGIN;
  context.fillStyle = '#f7f9fc';
  context.fillRect(0, 0, canvas.width, canvas.height);
  text(context, [`${data.date} · 戰場排表 · ${data.status}`], MARGIN, 24, 22, '#64748b');
  text(context, heading, MARGIN, 62, 30, '#0f172a', 700);
  let y = headerHeight;
  for (const group of groups) {
    const colors = COLORS[group.id];
    text(context, [group.name], MARGIN, y + 10, 26, colors.text, 700);
    group.teams.forEach((team, teamIndex) => {
      const x = MARGIN + teamIndex * (group.width + GAP);
      let rowY = y + 52;
      box(context, x, rowY, group.width, group.titleHeight, colors.background);
      text(context, team.title, x + 12, rowY + 12, 20, colors.text, 700);
      rowY += group.titleHeight;
      box(context, x, rowY, group.peopleWidth, 40, '#f1f5f9');
      box(context, x + group.peopleWidth, rowY, group.width - group.peopleWidth, 40, '#f1f5f9');
      text(context, ['職業／成員'], x + 12, rowY + 9, 18, '#64748b');
      text(context, ['職責／備註'], x + group.peopleWidth + 12, rowY + 9, 18, '#64748b');
      rowY += 40;
      team.rows.forEach((row, index) => {
        const height = group.rowHeights[index];
        box(context, x, rowY, group.peopleWidth, height);
        box(context, x + group.peopleWidth, rowY, group.width - group.peopleWidth, height);
        text(context, [String(index + 1)], x + 10, rowY + 12, 18, '#64748b');
        let personY = rowY + 12;
        for (const person of row.people) {
          if (person.round) {
            text(context, [person.round], x + 38, personY, 16, '#64748b');
            personY += 24;
          }
          if (person.job) {
            context.fillStyle = person.color;
            context.beginPath();
            context.arc(x + 44, personY + 10, 6, 0, Math.PI * 2);
            context.fill();
            text(context, [person.job], x + 58, personY, 16);
            personY += 24;
          }
          text(
            context,
            person.names,
            x + 38,
            personY,
            20,
            person.job ? '#0f172a' : '#64748b',
            person.job ? 600 : 400,
          );
          personY += person.names.length * 28 + 12;
        }
        text(context, row.description, x + group.peopleWidth + 12, rowY + 12);
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
