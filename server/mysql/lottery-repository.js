import { randomInt, randomUUID } from 'node:crypto';
import {
  drawLotteryPrize,
  emptyLotteryBoard,
  resetLotteryBoard,
  updateLotteryBoard,
} from '../../src/domain/lottery.js';

// One shared board, stored as a JSON document like the GAS store keeps it.
export function createLotteryRepository(db) {
  const options = {
    uuid: randomUUID,
    now: () => new Date().toISOString(),
    random: () => randomInt(0, 2 ** 32) / 2 ** 32,
  };
  async function read() {
    const row = (await db.prepare("SELECT board_json FROM lottery_boards WHERE id = 'default'").get());
    return row ? JSON.parse(row.board_json) : emptyLotteryBoard();
  }
  async function write(board) {
    (await db.prepare(
      `INSERT INTO lottery_boards (id, board_json, revision, updated_at) VALUES ('default', ?, ?, ?)
      ON DUPLICATE KEY UPDATE board_json = VALUES(board_json),
        revision = VALUES(revision), updated_at = VALUES(updated_at)`,
    ).run(JSON.stringify(board), board.revision, board.updatedAt));
  }
  return {
    async getLottery() {
      return { lottery: (await read()) };
    },
    async saveLottery(input) {
      return (await db.transaction(async () => {
        const board = updateLotteryBoard((await read()), input, options);
        (await write(board));
        return { lottery: board };
      }));
    },
    async drawLotteryPrize(input) {
      return (await db.transaction(async () => {
        const current = (await read());
        const { board, draw } = (await drawLotteryPrize(current, input?.prizeId, options));
        if (board !== current) (await write(board));
        return { lottery: board, draw };
      }));
    },
    async resetLottery(input) {
      return (await db.transaction(async () => {
        const current = (await read());
        const board = resetLotteryBoard(current, input?.revision, options);
        if (board !== current) (await write(board));
        return { lottery: board };
      }));
    },
  };
}
