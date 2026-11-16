import { asyncMap } from "./collections.js";
import { randomUUID } from 'node:crypto';
import { DutyError } from '../duty-repository.js';
export { DutyError } from '../duty-repository.js';

function dutyName(value) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 40 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new DutyError('請填寫 1–40 字的職責名稱');
  return value.trim();
}
export function createDutyRepository(db) {
  async function get(id) {
    const duty = (await db
      .prepare(
        'SELECT id,name,active,revision,created_at AS createdAt,updated_at AS updatedAt FROM duties WHERE id = ?',
      )
      .get(id));
    if (!duty) throw new DutyError('找不到這項職責，請重新載入清單', 404, 'DUTY_NOT_FOUND');
    return { ...duty, active: Boolean(duty.active) };
  }
  async function unique(name, id = '') {
    if ((await db.prepare('SELECT id FROM duties WHERE name = ? AND id != ?').get(name, id)))
      throw new DutyError('這個職責名稱已存在，請使用原項目或重新命名', 409, 'DUPLICATE_DUTY');
  }
  return {
    async listDuties() {
      return {
        duties: (await asyncMap(await db
          .prepare('SELECT id FROM duties ORDER BY created_at, created_order')
          .all(), async (row) => (await get(row.id)))),
      };
    },
    async addDuty(input) {
      const name = dutyName(input?.name);
      if (typeof input?.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.requestId))
        throw new DutyError('操作識別碼不正確，請重新操作');
      return (await db.transaction(async () => {
        const prior = (await db
          .prepare('SELECT id,original_name FROM duties WHERE request_id = ?')
          .get(input.requestId));
        if (prior) {
          if (prior.original_name !== name)
            throw new DutyError('此操作已用於其他職責，請重新操作', 409, 'REQUEST_CONFLICT');
          return (await get(prior.id));
        }
        (await unique(name));
        const id = randomUUID(),
          now = new Date().toISOString();
        (await db.prepare(
          'INSERT INTO duties (id,name,request_id,original_name,created_at,updated_at) VALUES (?,?,?,?,?,?)',
        ).run(id, name, input.requestId, name, now, now));
        return (await get(id));
      }));
    },
    async updateDuty(id, input) {
      const name = dutyName(input?.name);
      if (
        typeof input?.active !== 'boolean' ||
        !Number.isSafeInteger(input?.revision) ||
        input.revision < 1
      )
        throw new DutyError('職責狀態或版本格式不正確');
      return (await db.transaction(async () => {
        const current = (await get(id));
        const same = current.name === name && current.active === input.active;
        if (
          same &&
          (current.revision === input.revision || current.revision === input.revision + 1)
        )
          return current;
        if (current.revision !== input.revision)
          throw new DutyError('職責已被修改，請重新載入清單後再操作', 409, 'DUTY_CONFLICT');
        (await unique(name, id));
        (await db.prepare(
          'UPDATE duties SET name = ?,active = ?,revision = revision + 1,updated_at = ? WHERE id = ?',
        ).run(name, Number(input.active), new Date().toISOString(), id));
        return (await get(id));
      }));
    },
  };
}
