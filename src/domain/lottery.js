// Shared by the SQLite API and the GAS backend; avoid Node or browser-only APIs.
export const LOTTERY_MAX_PLAYERS = 500;
export const LOTTERY_MAX_PRIZES = 200;
const PLAYER_MAX_LENGTH = 64;
const PRIZE_MAX_LENGTH = 80;

export class LotteryError extends Error {
  constructor(message, status = 422, code = 'LOTTERY_INVALID', fields = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function emptyLotteryBoard() {
  return { players: [], prizes: [], revision: 0, updatedAt: null };
}

function lines(value, label, field, max, maxLength) {
  if (!Array.isArray(value) || value.length > max)
    throw new LotteryError(`${label}最多 ${max} 筆`, 422, 'LOTTERY_INVALID', {
      [field]: `${label}最多 ${max} 筆`,
    });
  return value.map((item, index) => {
    if (
      typeof item !== 'string' ||
      !item.trim() ||
      item.trim().length > maxLength ||
      /[\u0000-\u001f\u007f]/.test(item)
    )
      throw new LotteryError(
        `${label}第 ${index + 1} 筆格式不正確，每筆 1–${maxLength} 字`,
        422,
        'LOTTERY_INVALID',
        { [field]: `第 ${index + 1} 筆格式不正確，每筆 1–${maxLength} 字` },
      );
    return item.trim();
  });
}

function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new LotteryError('抽獎資料版本不正確，請重新載入');
  return value;
}

export function validateLotteryInput(input) {
  const players = lines(
    input?.players,
    '參加人員',
    'players',
    LOTTERY_MAX_PLAYERS,
    PLAYER_MAX_LENGTH,
  );
  // A player only needs to run once; prizes may repeat (e.g. three identical gifts).
  const unique = players.filter((name, index) => players.indexOf(name) === index);
  const prizes = lines(input?.prizes, '獎品', 'prizes', LOTTERY_MAX_PRIZES, PRIZE_MAX_LENGTH);
  return { players: unique, prizes, revision: revision(input?.revision) };
}

export function checkLotteryRevision(board, expected) {
  if (revision(expected) !== board.revision)
    throw new LotteryError('抽獎名單已被其他人更新，請重新載入後再操作', 409, 'LOTTERY_CONFLICT');
}

// Prizes that keep their name keep their ID and winner, matched in list order so
// duplicates stay paired with the earliest unmatched prize of the same name.
export function updateLotteryBoard(board, input, { uuid, now }) {
  const values = validateLotteryInput(input);
  checkLotteryRevision(board, values.revision);
  const unmatched = board.prizes.slice();
  const prizes = values.prizes.map((name) => {
    const index = unmatched.findIndex((prize) => prize.name === name);
    if (index >= 0) return unmatched.splice(index, 1)[0];
    return { id: uuid(), name, winner: null, drawnAt: null };
  });
  return {
    players: values.players,
    prizes,
    revision: board.revision + 1,
    updatedAt: now(),
  };
}

export function lotteryRunners(board, prize = null) {
  const winners = new Set(board.prizes.map((item) => item.winner).filter(Boolean));
  return board.players.filter((name) => !winners.has(name) || name === prize?.winner);
}

export function drawLotteryPrize(board, prizeId, { now, random }) {
  if (typeof prizeId !== 'string' || !prizeId) throw new LotteryError('請先選擇要抽的獎品');
  const prize = board.prizes.find((item) => item.id === prizeId);
  if (!prize)
    throw new LotteryError('找不到這個獎品，請重新載入名單', 404, 'LOTTERY_PRIZE_NOT_FOUND');
  const runners = lotteryRunners(board, prize);
  // Drawing the same prize again (double click or retry) returns the stored winner.
  if (prize.winner)
    return {
      board,
      draw: { prizeId, prize: prize.name, winner: prize.winner, runners, already: true },
    };
  if (!runners.length)
    throw new LotteryError('所有參加人員都已經中獎了', 409, 'LOTTERY_NO_RUNNERS');
  const pick = Math.floor(random() * runners.length);
  const winner = runners[Math.min(Math.max(pick, 0), runners.length - 1)];
  const drawnAt = now();
  return {
    board: {
      ...board,
      prizes: board.prizes.map((item) =>
        item.id === prizeId ? { ...item, winner, drawnAt } : item,
      ),
      revision: board.revision + 1,
      updatedAt: drawnAt,
    },
    draw: { prizeId, prize: prize.name, winner, runners, already: false },
  };
}

export function resetLotteryBoard(board, expected, { now }) {
  checkLotteryRevision(board, expected);
  if (!board.prizes.some((prize) => prize.winner)) return board;
  return {
    ...board,
    prizes: board.prizes.map((prize) => ({ ...prize, winner: null, drawnAt: null })),
    revision: board.revision + 1,
    updatedAt: now(),
  };
}
