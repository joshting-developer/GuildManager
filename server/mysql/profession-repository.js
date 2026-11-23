import { ProfessionError, validateProfession } from '../../src/domain/professions.js';

export function createProfessionRepository(db) {
  async function get(id) {
    const profession = await db.prepare('SELECT job_id, name, colorcode, revision FROM professions WHERE job_id = ?').get(id);
    if (!profession) throw new ProfessionError('找不到這個職業, 請重新載入清單', 404, 'PROFESSION_NOT_FOUND');
    return profession;
  }
  async function unique(name, id = 0) {
    if (await db.prepare('SELECT job_id FROM professions WHERE name = ? AND job_id != ?').get(name, id))
      throw new ProfessionError('這個職業名稱已存在', 409, 'DUPLICATE_PROFESSION');
  }
  return {
    async listProfessions() {
      return { professions: await db.prepare('SELECT job_id, name, colorcode, revision FROM professions ORDER BY job_id LIMIT 1000').all() };
    },
    async addProfession(input) {
      const values = validateProfession(input);
      const fingerprint = JSON.stringify(values);
      return db.transaction(async () => {
        // Lock the last catalogue row so concurrent additions allocate distinct stable IDs.
        const last = await db.prepare('SELECT job_id FROM professions ORDER BY job_id DESC LIMIT 1 FOR UPDATE').get();
        const prior = await db.prepare('SELECT job_id, original_input FROM professions WHERE request_id = ?').get(input.requestId);
        if (prior) {
          if (prior.original_input !== fingerprint) throw new ProfessionError('此操作已用於其他職業, 請重新操作', 409, 'REQUEST_CONFLICT');
          return get(prior.job_id);
        }
        await unique(values.name);
        if (last?.job_id >= 1000) throw new ProfessionError('職業清單已達 1000 項上限');
        const id = (last?.job_id || 0) + 1;
        await db.prepare('INSERT INTO professions (job_id, name, colorcode, request_id, original_input) VALUES (?, ?, ?, ?, ?)')
          .run(id, values.name, values.colorcode, input.requestId, fingerprint);
        return get(id);
      });
    },
    async updateProfession(id, input) {
      const values = validateProfession(input, true);
      if (!Number.isSafeInteger(id) || id < 1) throw new ProfessionError('職業識別碼不正確');
      return db.transaction(async () => {
        await db.prepare('SELECT job_id FROM professions WHERE job_id = ? FOR UPDATE').get(id);
        const current = await get(id);
        const same = current.name === values.name && current.colorcode === values.colorcode;
        if (same && [input.revision, input.revision + 1].includes(current.revision)) return current;
        if (current.revision !== input.revision) throw new ProfessionError('職業已被修改, 請重新載入清單後再操作', 409, 'PROFESSION_CONFLICT');
        await unique(values.name, id);
        await db.prepare('UPDATE professions SET name = ?, colorcode = ?, revision = revision + 1 WHERE job_id = ?')
          .run(values.name, values.colorcode, id);
        return get(id);
      });
    },
  };
}
