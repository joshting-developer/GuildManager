import { randomInt, randomUUID } from 'node:crypto';
import {
  drawLotteryPrize,
  emptyLotteryBoard,
  resetLotteryBoard,
  updateLotteryBoard,
} from '../src/domain/lottery.js';

// One shared board, stored as a JSON document like the GAS store keeps it.
export function createLotteryRepository(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS lottery_boards (
    id TEXT PRIMARY KEY CHECK (id = 'default'),
    board_json TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    updated_at TEXT
  );`);
  const options = {
    uuid: randomUUID,
    now: () => new Date().toISOString(),
    random: () => randomInt(0, 2 ** 32) / 2 ** 32,
  };
  function read() {
    const row = db.prepare("SELECT board_json FROM lottery_boards WHERE id = 'default'").get();
    return row ? JSON.parse(row.board_json) : emptyLotteryBoard();
  }
  function write(board) {
    db.prepare(
      `INSERT INTO lottery_boards (id, board_json, revision, updated_at) VALUES ('default', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET board_json = excluded.board_json,
        revision = excluded.revision, updated_at = excluded.updated_at`,
    ).run(JSON.stringify(board), board.revision, board.updatedAt);
  }
  return {
    getLottery() {
      return { lottery: read() };
    },
    saveLottery(input) {
      return db.transaction(() => {
        const board = updateLotteryBoard(read(), input, options);
        write(board);
        return { lottery: board };
      })();
    },
    drawLotteryPrize(input) {
      return db.transaction(() => {
        const current = read();
        const { board, draw } = drawLotteryPrize(current, input?.prizeId, options);
        if (board !== current) write(board);
        return { lottery: board, draw };
      })();
    },
    resetLottery(input) {
      return db.transaction(() => {
        const current = read();
        const board = resetLotteryBoard(current, input?.revision, options);
        if (board !== current) write(board);
        return { lottery: board };
      })();
    },
  };
}
