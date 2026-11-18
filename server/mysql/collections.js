export async function asyncMap(values, callback) {
  const result = [];
  for (let index = 0; index < values.length; index++) result.push(await callback(values[index], index, values));
  return result;
}
