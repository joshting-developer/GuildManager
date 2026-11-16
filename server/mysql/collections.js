export async function asyncMap(values, callback) {
  const result = [];
  for (let index = 0; index < values.length; index++) result.push(await callback(values[index], index, values));
  return result;
}
export async function asyncFilter(values, callback) {
  const result = [];
  for (let index = 0; index < values.length; index++) if (await callback(values[index], index, values)) result.push(values[index]);
  return result;
}
export async function asyncFindIndex(values, callback) {
  for (let index = 0; index < values.length; index++) if (await callback(values[index], index, values)) return index;
  return -1;
}
export async function asyncFind(values, callback) { const index = await asyncFindIndex(values, callback); return index < 0 ? undefined : values[index]; }
export async function asyncSome(values, callback) { return (await asyncFindIndex(values, callback)) >= 0; }
export async function asyncEvery(values, callback) { return !(await asyncSome(values, async (...args) => !(await callback(...args)))); }
