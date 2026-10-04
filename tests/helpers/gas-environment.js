import { randomUUID } from 'node:crypto';
export function gasEnvironment() {
  const sheets = new Map(),
    properties = new Map(),
    files = new Map();
  let failTable = null;
  const utilities = {
    Charset: { UTF_8: 'UTF-8' },
    getUuid: randomUUID,
    base64Encode: (input) => Buffer.from(input).toString('base64'),
    base64Decode: (input) => [...Buffer.from(input, 'base64')],
    newBlob(input, mimeType, name) {
      const buffer = Buffer.from(input);
      return {
        getDataAsString: () => buffer.toString('utf8'),
        getBytes: () => [...buffer],
        getContentType: () => mimeType,
        getName: () => name,
      };
    },
  };
  function makeSheet(name) {
    const data = [];
    return {
      name,
      data,
      setFrozenRows() {},
      getLastRow: () => data.length,
      getLastColumn: () => Math.max(0, ...data.map((row) => row.length)),
      getRange(row, col, height, width) {
        return {
          getValues: () =>
            Array.from({ length: height }, (_, y) =>
              Array.from({ length: width }, (_, x) => data[row - 1 + y]?.[col - 1 + x] ?? ''),
            ),
          setValues(values) {
            if (failTable === name) throw new Error('simulated write failure');
            for (let y = 0; y < height; y++) {
              if (!data[row - 1 + y]) data[row - 1 + y] = [];
              for (let x = 0; x < width; x++) data[row - 1 + y][col - 1 + x] = values[y][x];
            }
          },
        };
      },
    };
  }
  const spreadsheet = {
    getSheetByName: (name) => sheets.get(name),
    insertSheet: (name) => {
      const sheet = makeSheet(name);
      sheets.set(name, sheet);
      return sheet;
    },
  };
  const propertyService = {
    getProperty: (key) => properties.get(key) ?? null,
    setProperty: (key, value) => properties.set(key, value),
    deleteProperty: (key) => properties.delete(key),
    getProperties: () => Object.fromEntries(properties),
  };
  const folder = {
    createFile(blob) {
      const id = randomUUID();
      const file = { getId: () => id, getBlob: () => blob };
      files.set(id, file);
      return file;
    },
    getId: () => 'test-folder',
  };
  let locked = false;
  const lock = {
    tryLock() {
      if (locked) return false;
      locked = true;
      return true;
    },
    releaseLock() {
      locked = false;
    },
  };
  return {
    sheets,
    properties,
    files,
    spreadsheet,
    utilities,
    propertyService,
    folder,
    lock,
    failOn: (table) => {
      failTable = table;
    },
    globals: {
      Utilities: utilities,
      SpreadsheetApp: { openById: () => spreadsheet },
      PropertiesService: { getScriptProperties: () => propertyService },
      LockService: { getScriptLock: () => lock },
      DriveApp: {
        createFolder: () => folder,
        getFolderById: () => folder,
        getFileById: (id) => {
          if (!files.has(id)) throw new Error('missing file');
          return files.get(id);
        },
      },
    },
  };
}
