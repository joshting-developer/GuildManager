import { BattleRecordError } from './battle-records.js';

// Only match labels and results may change; uploaded player data stays intact.
export function validateBattleMetadata(input, type) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BattleRecordError('對戰資訊格式不正確');
  const allowed = [
    'redTeam',
    'blueTeam',
    'winner',
    'ourSide',
    'isInternal',
    'revision',
    'requestId',
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new BattleRecordError('只能修改雙方名稱、敵我、勝方及內推設定');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0)
    throw new BattleRecordError('資料版本不正確，請重新載入');
  if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.requestId))
    throw new BattleRecordError('操作識別碼不正確，請重新操作');
  const name = (value, label) => {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.trim().length > 120 ||
      /[\u0000-\u001f\u007f]/.test(value)
    )
      throw new BattleRecordError(`${label}須為 1–120 字`);
    return value.trim();
  };
  if (typeof input.isInternal !== 'boolean' || (input.isInternal && type !== 'scrimmage'))
    throw new BattleRecordError('只有約戰可以設定內推');
  for (const key of ['ourSide', 'winner']) {
    if (input[key] !== null && input[key] !== '' && !['red', 'blue'].includes(input[key]))
      throw new BattleRecordError('敵我與獲勝方只能選紅方／藍方或留空');
  }
  return {
    redTeam: name(input.redTeam, '紅方名稱'),
    blueTeam: name(input.blueTeam, '藍方名稱'),
    winner: input.isInternal ? null : input.winner || null,
    ourSide: input.isInternal ? null : input.ourSide || null,
    isInternal: input.isInternal,
  };
}
