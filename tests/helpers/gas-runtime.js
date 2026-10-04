import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build } from 'vite';
import { gasEnvironment } from './gas-environment.js';
import { GAS_BACKEND_TARGET } from '../../gas/build-options.js';

let bundle;
export async function gasRuntime() {
  bundle ||= build({
    configFile: false,
    logLevel: 'silent',
    build: {
      target: GAS_BACKEND_TARGET,
      minify: false,
      write: false,
      lib: { entry: 'gas/src/backend.js', formats: ['iife'], name: 'GuildGas' },
    },
  }).then(
    (result) =>
      (Array.isArray(result) ? result[0] : result).output.find((item) => item.type === 'chunk')
        .code,
  );
  const env = gasEnvironment();
  const properties = env.propertyService;
  properties.setProperty('SPREADSHEET_ID', 'test-spreadsheet');
  properties.setProperty('AUTH_SECRET', 'a'.repeat(64));
  properties.setProperty('BOOTSTRAP_ADMIN_USERNAME', 'admin');
  properties.setProperty('BOOTSTRAP_ADMIN_PASSWORD', 'initial-password-123');
  properties.setProperty('GUILD_NAME', '測試幫會');
  const sandbox = vm.createContext({
    ...env.globals,
    TextEncoder: undefined,
    TextDecoder: undefined,
    console: undefined,
  });
  vm.runInContext(
    'Object.hasOwn = undefined; Array.prototype.at = undefined; String.prototype.replaceAll = undefined;',
    sandbox,
  );
  vm.runInContext(await bundle, sandbox);
  vm.runInContext(readFileSync('gas/Code.gs', 'utf8'), sandbox);
  const normalize = (value) => JSON.parse(JSON.stringify(value));
  return {
    ...env,
    sandbox,
    setup: () => normalize(sandbox.setupGas_()),
    raw: (operation, args = [], context) =>
      normalize(sandbox[operation](...args, ...(context ? [context] : []))),
    rpc: (operation, args = [], context = {}) =>
      normalize(sandbox.GuildGas.rpc(operation, args, context)),
  };
}
export function cloudSession(session) {
  return { sessionToken: session.sessionToken, csrfToken: session.csrfToken };
}
export function cloudResult(result) {
  if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
  return result.data;
}
export const fixtureCsv = (redName = '城', blueName = '對手') =>
  [
    '玩家名字,職業,擊敗,助攻,資源,對玩家傷害,對建築傷害,治療值,承受傷害,重傷,化羽/清泉,焚骨',
    `${redName},碎夢,10,20,5,1000,2000,,3000,2,0,`,
    '玩家名字,職業,擊敗,助攻,資源,對玩家傷害,對建築傷害,治療值,承受傷害,重傷,化羽/清泉,焚骨',
    `${blueName},素問,2,4,3,500,100,4000,6000,0,3,2`,
  ].join('\n');
