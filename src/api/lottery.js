import { callGas } from './gas.js';
import { sessionFetch } from './session.js';

export function createLotteryClient({
  source = 'local',
  fetchImpl = sessionFetch,
  googleRun,
} = {}) {
  if (!['local', 'gas'].includes(source)) throw new Error('未知的資料來源設定');
  async function call(method, path, input, operation) {
    const data =
      source === 'gas'
        ? await callGas(operation, input === undefined ? [] : [input], googleRun)
        : await http(method, path, input);
    if (!validBoard(data?.lottery) || (operation === 'drawLotteryPrize' && !validDraw(data.draw)))
      throw new Error('抽獎資料回應格式不正確，請重新載入');
    return data;
  }
  async function http(method, path, input) {
    let response;
    try {
      response = await fetchImpl(`/api/${path}`, {
        method,
        ...(input === undefined
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
      });
    } catch {
      throw new Error('無法連線，請確認本機服務已啟動後重試');
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('抽獎資料回應格式不正確，請重新載入');
    }
    if (!response.ok) {
      const error = new Error(data.error?.message || '目前無法完成抽獎操作，請稍後再試');
      error.code = data.error?.code;
      error.fields = data.error?.fields || {};
      throw error;
    }
    return data;
  }
  function validBoard(board) {
    return (
      board &&
      Array.isArray(board.players) &&
      board.players.every((name) => typeof name === 'string') &&
      Array.isArray(board.prizes) &&
      board.prizes.every(
        (prize) =>
          prize &&
          typeof prize.id === 'string' &&
          typeof prize.name === 'string' &&
          (prize.winner === null || typeof prize.winner === 'string'),
      ) &&
      Number.isSafeInteger(board.revision)
    );
  }
  function validDraw(draw) {
    return (
      draw &&
      typeof draw.prizeId === 'string' &&
      typeof draw.winner === 'string' &&
      Array.isArray(draw.runners) &&
      draw.runners.includes(draw.winner)
    );
  }
  return {
    getLottery: () => call('GET', 'lottery', undefined, 'getLottery'),
    saveLottery: (input) => call('PATCH', 'lottery', input, 'saveLottery'),
    drawPrize: (prizeId) => call('POST', 'lottery/draws', { prizeId }, 'drawLotteryPrize'),
    resetLottery: (revision) => call('DELETE', 'lottery/draws', { revision }, 'resetLottery'),
  };
}
