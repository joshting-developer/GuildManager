import {
  drawLotteryPrize,
  emptyLotteryBoard,
  resetLotteryBoard,
  updateLotteryBoard,
} from '../../src/domain/lottery.js';

const KEY = 'default';

export function createLottery(store, { uuid, now }) {
  const options = { uuid, now, random: Math.random };
  // Projects initialized before the lottery existed gain the sheet on first use.
  function read() {
    store.ensureTable('lottery');
    return store.get('lottery', KEY) || emptyLotteryBoard();
  }
  return {
    getLottery: () => ({ lottery: read() }),
    saveLottery([input]) {
      const board = updateLotteryBoard(read(), input, options);
      store.put('lottery', KEY, board);
      return { lottery: board };
    },
    drawLotteryPrize([input]) {
      const current = read();
      const { board, draw } = drawLotteryPrize(current, input?.prizeId, options);
      if (board !== current) store.put('lottery', KEY, board);
      return { lottery: board, draw };
    },
    resetLottery([input]) {
      const current = read();
      const board = resetLotteryBoard(current, input?.revision, options);
      if (board !== current) store.put('lottery', KEY, board);
      return { lottery: board };
    },
  };
}
